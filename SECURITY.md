# Security and sensitive data

Do not submit patient images, patient identifiers, clinical exports, adjustment sidecars, practice network details, credentials or production logs in issues, pull requests or screenshots. Use the committed synthetic fixtures and invented test identities.

Files opened by the application can contain identifiers in metadata, filenames and embedded pixel text. Removing a displayed name does not de-identify an image. Exports and sidecars should be treated as sensitive whenever the source is sensitive. The viewer reads and writes local files, creates settings and may write demo data under the user profile; do not interpret local operation as a compliance guarantee. Printing submits image content to the operating system and printer driver.

Delete moves selected files and sidecars into a DELETED directory; it is not secure erasure. Back up authorized test material before exercising file-management functions.

For a suspected vulnerability, do not publish sensitive details or attachments. Ask the maintainer for a private reporting channel. No dedicated security inbox or response service has been established for this review snapshot.
