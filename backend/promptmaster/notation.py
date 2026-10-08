"""How mathematics and code are written in what PromptMaster produces (M1, 8 Oct).

Sean, 6–7 Oct: "Equations had stray commas, missing equals signs, visible
LaTeX markup, and a broken summary heading"; "Programming code should appear
separately with its language identified and indentation preserved." The page
draws LaTeX with KaTeX and fenced code with its language
(`frontend/src/lib/markdown/math.ts`); this is the half that asks for it in a
form that renders, and that survives copying and export unchanged.
"""

NOTATION_RULE = (
    "MATHEMATICS AND CODE. Write mathematics in LaTeX: inline as \\( … \\), and each "
    "displayed equation on its own lines between $$ and $$ (a multi-line derivation in "
    "\\begin{aligned} … \\end{aligned}, one step per line, aligned at =). Use real symbols "
    "through LaTeX — \\frac, \\sqrt, \\sum, subscripts, superscripts, Greek letters, "
    "matrices with \\begin{pmatrix} — never plain-text or Unicode approximations, and never "
    "a comma where an equals sign belongs. Write a dollar amount as plain text ($8,000), "
    "never inside maths. Put code in a fenced block that names its language (```python), "
    "complete, with its indentation exact; say plainly whether it was run or is only "
    "proposed, and never present output that was not produced by running it."
)
