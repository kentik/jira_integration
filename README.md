# Kentik Jira Integrations

Forge apps and supporting packages for integrating Kentik workflows with Jira.

## Self-Managed Use

This repository is a reference implementation provided as source code for users who want to deploy the integration into their own Atlassian environment. Customer-deployed copies are registered, configured, hosted, and operated under the customer's Atlassian developer account and Jira site.

Kentik does not operate, monitor, or control customer-deployed copies of this app. Users are responsible for reviewing the code, configuring credentials and scopes, securing secrets, operating the app, and maintaining any modifications they make.

## Authorization Model

Self-managed deployments use the Kentik API credential configured by the Jira administrator. Actions performed through the app use that Kentik identity, even when different Jira users trigger those actions from Jira issues.

Use a dedicated least-privilege Kentik user reserved for the integration, and review the app-specific authorization guidance in [apps/alerts-integration/README.md](apps/alerts-integration/README.md).

## License

This repository is licensed under the Apache License 2.0. See [LICENSE](LICENSE). The software is provided as is, without warranties or conditions of any kind.

## Apps

- `apps/alerts-integration` - Atlassian Forge app for syncing Jira/JSM alert workflows with Kentik and launching Kentik AI investigations.

## Deploy

See [apps/alerts-integration/README.md](apps/alerts-integration/README.md).

## Guides

- [docs/jira-automation-deduplication.md](docs/jira-automation-deduplication.md) - Configure Jira global automation to deduplicate issues for repeated Kentik alert state changes.
- [docs/jsm-alert-deduplication.md](docs/jsm-alert-deduplication.md) - Configure Jira Service Management Operations alert deduplication with the Kentik JSM notification channel.