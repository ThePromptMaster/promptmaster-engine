"""What PromptMaster can and cannot read (Sean, 18 Oct, email 7).

A beta user's cookbook depended on an Instagram account's videos. Nothing in
PromptMaster fetches a user's link — the only outbound calls are to the model,
OpenAlex and pricing — so a brief that rests on a link rests on nothing. The
intake says so plainly, before any work is built on it.
"""

LINKS_RULE = (
    "PromptMaster cannot open links, web pages or videos (Instagram, YouTube, TikTok and the "
    "like) — it reads only what the user types, pastes or uploads. When the request depends on "
    "what is behind a link or in a video, say so plainly and ask the user to paste the text "
    "(a transcript, captions, a description) or upload files; never write as if you had seen it."
)
