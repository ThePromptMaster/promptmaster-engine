"""PromptMaster checks a source itself before asking the user (Sean, 5 Oct).

"If it can retrieve the source, inspect it, determine whether it actually
supports the claim, and record provenance, that should become something like
AI verified, which should remain distinct from Human verified."

What is read is the record's abstract in OpenAlex — the part of a work a public
index holds for free. A claim the abstract states is "AI verified (abstract)";
one it contradicts is flagged; one it does not settle stays with the user, who
can read the whole work. Nothing stronger is claimed than what was read: the
ceiling is the abstract.

The model must quote the sentence it relied on, and code checks the quote is
really in the abstract. A verdict whose quote is not there is dropped to "can't
tell" — the same guard as figure extraction, where a value is kept only if the
text contains it.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

from .literature import OPENALEX_URL
from .llm_client import OpenRouterClient
from .schemas import PMInput

MAX_VERIFY = 20
#: An abstract longer than this is cut; abstracts rarely are.
MAX_ABSTRACT_CHARS = 4_000

Verdict = Literal["supports", "partly", "does_not", "cannot_tell"]


class SourceToVerify(BaseModel):
    id: str = Field(max_length=80)
    #: What the row says the source establishes.
    claim: str = Field(max_length=1_000)
    #: The DOI or OpenAlex link a lookup put on the row.
    link: str = Field(default="", max_length=300)


class SourceVerdict(BaseModel):
    id: str
    verdict: Verdict = "cannot_tell"
    #: The sentence of the abstract relied on, verbatim; "" when none.
    quote: str = ""
    basis: Literal["abstract", "none"] = "none"
    #: Why, in one line — always set when the verdict is cannot_tell.
    note: str = ""


def abstract_from_index(inverted: Any) -> str:
    """OpenAlex keeps an abstract as word → positions; this puts it back in order."""
    if not isinstance(inverted, dict) or not inverted:
        return ""
    placed: dict[int, str] = {}
    for word, positions in inverted.items():
        if not isinstance(positions, list):
            continue
        for p in positions:
            if isinstance(p, int) and p >= 0:
                placed[p] = str(word)
    return " ".join(placed[i] for i in sorted(placed))[:MAX_ABSTRACT_CHARS]


def _norm(text: str) -> str:
    text = text.lower().replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return " ".join(re.sub(r"[^\w%'.,;:()\-\"/ ]+", " ", text).split()).strip(" .")


def quote_is_in(quote: str, abstract: str) -> bool:
    q = _norm(quote)
    return len(q) >= 12 and q in _norm(abstract)


_DOI = re.compile(r"10\.\d{4,9}/\S+", re.I)


def index_key(link: str) -> str | None:
    """The OpenAlex address for a row's link: by DOI, or by OpenAlex id."""
    link = link.strip()
    doi = _DOI.search(link)
    if doi:
        return f"https://doi.org/{doi.group(0).rstrip('.,;)')}"
    if re.match(r"https?://openalex\.org/W\d+", link):
        return link.rsplit("/", 1)[-1]
    return None


async def fetch_abstract(http: httpx.AsyncClient, link: str) -> tuple[str, str]:
    """(abstract, note). An empty abstract always comes with a note saying why."""
    key = index_key(link)
    if not key:
        return "", "No DOI or index record on the row to read."
    try:
        response = await http.get(f"{OPENALEX_URL}/{key}", params={"select": "id,abstract_inverted_index"}, timeout=12.0)
        if response.status_code == 404:
            return "", "The index has no record at that DOI."
        response.raise_for_status()
        abstract = abstract_from_index(response.json().get("abstract_inverted_index"))
    except (httpx.HTTPError, ValueError):
        return "", "The index could not be reached; nothing was read."
    return (abstract, "") if abstract else ("", "The index holds no abstract for this work; it needs reading in full.")


_VERIFY_INSTRUCTION = (
    "You check whether published sources support what a research project says they "
    "establish. For each item you are given the claim and the source's abstract — the "
    "only part of the source you can read. Judge ONLY from the abstract:\n"
    "- supports: the abstract states what the claim says\n"
    "- partly: it states part of it, or something weaker or narrower\n"
    "- does_not: it states something that contradicts the claim\n"
    "- cannot_tell: the abstract does not settle it either way\n"
    "For supports, partly and does_not, quote the one sentence of the abstract you relied "
    "on, copied exactly. Never quote anything that is not in the abstract. Return JSON only."
)


def build_verify_prompt(inputs: PMInput, items: list[tuple[SourceToVerify, str]]) -> tuple[str, str]:
    blocks = "\n\n".join(f"ITEM id={s.id}\nCLAIM: {s.claim}\nABSTRACT: {abstract}" for s, abstract in items)
    user = (
        f"PROJECT OBJECTIVE: {inputs.objective}\n\n{blocks}\n\n"
        'Return JSON: {"verdicts": [{"id": "...", "verdict": "supports|partly|does_not|cannot_tell", '
        '"quote": "the exact sentence, or empty"}]}'
    )
    return _VERIFY_INSTRUCTION, user


def parse_verdicts(result: object, abstracts: dict[str, str]) -> dict[str, SourceVerdict]:
    out: dict[str, SourceVerdict] = {}
    raw = result.get("verdicts") if isinstance(result, dict) else None
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict) or str(r.get("id")) not in abstracts:
            continue
        sid = str(r["id"])
        verdict = str(r.get("verdict") or "").strip().lower()
        quote = " ".join(str(r.get("quote") or "").split())[:400]
        if verdict not in ("supports", "partly", "does_not"):
            out[sid] = SourceVerdict(id=sid, verdict="cannot_tell", basis="abstract", note="The abstract does not settle it.")
        elif not quote_is_in(quote, abstracts[sid]):
            out[sid] = SourceVerdict(id=sid, verdict="cannot_tell", basis="abstract",
                                     note="The check could not point to a sentence in the abstract, so nothing is claimed.")
        else:
            out[sid] = SourceVerdict(id=sid, verdict=verdict, quote=quote, basis="abstract")  # type: ignore[arg-type]
    return out


def _mock_abstract(link: str) -> tuple[str, str]:
    """Scripted abstracts for the browser tests: a link ending ".1" supports its claim, ".2" has none."""
    if link.rstrip("/").endswith(".2"):
        return "", "The index holds no abstract for this work; it needs reading in full."
    return "Mock abstract. This study shows the effect holds in every case examined. Further work is needed.", ""


async def verify_sources(
    client: OpenRouterClient, model: str | None, inputs: PMInput, sources: list[SourceToVerify], *, mock: bool = False
) -> list[SourceVerdict]:
    sources = sources[:MAX_VERIFY]
    if mock:
        fetched = [_mock_abstract(s.link) for s in sources]
    else:
        async with httpx.AsyncClient() as http:
            fetched = list(await asyncio.gather(*(fetch_abstract(http, s.link) for s in sources)))
    readable = [(s, a) for s, (a, _) in zip(sources, fetched) if a]
    verdicts: dict[str, SourceVerdict] = {}
    if readable:
        system, user = build_verify_prompt(inputs, readable)
        result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=1_500, model=model)
        verdicts = parse_verdicts(result, {s.id: a for s, a in readable})
    out: list[SourceVerdict] = []
    for s, (abstract, note) in zip(sources, fetched):
        if s.id in verdicts:
            out.append(verdicts[s.id])
        elif abstract:
            out.append(SourceVerdict(id=s.id, basis="abstract", note="The check returned nothing for this source."))
        else:
            out.append(SourceVerdict(id=s.id, note=note))
    return out
