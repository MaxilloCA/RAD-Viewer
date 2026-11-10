# Snapshot provenance

Prepared from the local development working tree, not from its Git history. The original working tree and all original data remain untouched. Version 0.9.11 identifies the upstream development version. The November 9 refresh brings over the new image defaults and processing shortcuts while retaining the public demo and storage configuration.

SOURCE_ALLOWLIST.txt records each source file selected for copying. Public documentation, CI, ignore rules, the fixture generator and synthetic fixtures are newly authored in this snapshot. A final manifest records every intended public file and checksum.

Excluded: Git history, environment files, dependency/build/output/temp directories, all Sample RAD Files, all original demo data, practice logos, operational deployment instructions, private verification reports, packaging scripts and source examples tied to local data.

Sanitization: the five embedded demo DICOMs and PatientInfo.xml are fresh mathematical patterns generated entirely by scripts/generate_synthetic_demo.py. Their dates and identity are invented. Demo paths/name were adapted accordingly. Office export logo/contact text were replaced with the app icon and generic text; About retains Michal Goralski's attribution but omits personal email/location. Patient-number lookup now requires RAD_VIEWER_PATIENT_ROOT and exports default to local Pictures, avoiding preconfigured practice network locations. Tests and UI guidance were adapted. These changes apply only to this public snapshot. No deployment was performed.

The original ignored private-sample performance tests remain as development references; their data is neither included nor required by normal tests. No patient-derived screenshots are included.
