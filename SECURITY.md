# Security Policy

## Reporting A Vulnerability

Please do not publish exploit details in a public issue before maintainers have had time to respond.

Preferred reporting options:

- Use GitHub private vulnerability reporting if it is enabled for the repository.
- Otherwise, open a minimal public issue saying you have a security report, without sensitive details.

Please include:

- Affected version or commit SHA.
- Impact and affected feature.
- Reproduction steps or proof of concept.
- Any relevant logs, with secrets and production data removed.

## Sensitive Data

Redix is a Redis client and may display production keys and values. When reporting bugs:

- Redact Redis hostnames, usernames, passwords, tokens, and private network details.
- Redact key names and values if they contain customer or business data.
- Do not attach local app storage files unless explicitly requested and sanitized.

## Supported Versions

Until the project publishes formal releases, security fixes target the latest `main` branch.
