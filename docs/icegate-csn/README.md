# ICEGATE CSN (Cargo Summary Notification) — the official specification

Downloaded 26 Sep 2026 from ICEGATE → Advisories → SCMTR → Message Implementation Guide (MIG):
https://www.icegate.gov.in/guidelines/scmtr/message-implementation-guide-mig
("Message Implementation Guideline – Notified Sea Carriers other than ASC/ASA", Ver 1.6, 14 Aug 2026,
file `SACHM22_MIG-Csn-AK1_14Aug2026.docx`). Check that page for a newer version before relying on this.

- `MIG_CSN_SACHM22_v1.6_14Aug2026.docx` — the guide itself; `.txt` is its text, for searching.
- `schemas/` — the JSON schemas embedded in the guide: SCE/SCX/SCD, SCA (amendment), SCU, and the
  outbound ACK and SFL (structural failure) schemas.
- `samples/` — Customs' sample declarations (`_DEC`) and the acknowledgements / failures they return.

Messages (message id SACHM22): SCE = CSN on entry (imports), SCX = on exit (exports),
SCD = domestic movements, SCA = amendment, SCU = identification number update, SCC = confirmation.

File name: `F_SACHM22_<event>_<ICEGATE ID>_<job no>_<date>_DEC.json`. The declaration is digitally
signed (a `digSign` block inside the JSON, from ICEGATE's signing utility and the filer's Class III
DSC) and submitted by web upload on ICEGATE or by mail (SMTP). ICEGATE answers with an SFL file
(structure failed) or an ACK (business validation, with error codes in section 7 of the guide).
