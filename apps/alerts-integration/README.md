# Kentik Alerts Integration for Jira

This is an Atlassian Forge app for Jira that connects Jira issues and Jira Service Management Operations alerts with Kentik alert workflows. It can set Kentik external context when issues are created, mirror selected Jira updates back to Kentik alerts, and provide a Jira issue action for Kentik AI investigation.

## Self-Managed Deployment

This app is a reference implementation provided as source code for users who want to deploy the integration into their own Atlassian environment.

When you run `forge register`, `forge deploy`, and `forge install`, the resulting Forge app is registered, configured, hosted, and operated under your Atlassian developer account and Jira site. You are responsible for reviewing the code, selecting appropriate permissions and scopes, configuring credentials, securing secrets, operating the app, and maintaining any modifications you make.

Kentik does not operate, monitor, or control customer-deployed copies of this app.

## License

This app is licensed under the Apache License 2.0. See [../../LICENSE](../../LICENSE). The software is provided as is, without warranties or conditions of any kind.

## What the App Provides

- A Jira admin page for Kentik API configuration.
- Jira issue-created and issue-updated triggers for alert synchronization.
- Optional sync controls for acknowledge, comments, and clear actions.
- A Jira issue action that starts or continues a Kentik AI investigation when a `kentik-alertId` issue property exists.

## Requirements

- Node.js compatible with the Forge CLI.
- The Atlassian Forge CLI installed and authenticated.
- Access to a Jira Cloud site where you can install Forge apps.
- Kentik API credentials with access to the alert and AI Advisor APIs used by this app.

Install and authenticate the Forge CLI by following Atlassian's setup guide:

https://developer.atlassian.com/platform/forge/set-up-forge/

## Fresh Setup

Install dependencies from the lockfile:

```bash
npm ci
```

Log in to Forge if you have not already:

```bash
forge login
```

This repository intentionally does not commit a Forge `app.id`. Register a new Forge app for your Atlassian developer account before running Forge validation, deployment, or installation commands:

```bash
forge register
```

That command adds an `app.id` to `manifest.yml`. The generated app id is specific to your Atlassian developer account and should not be reused across unrelated Forge apps.

## Select the Kentik Region

Before deploying, confirm that `manifest.yml` allows outbound Forge backend requests to the Kentik API host for your region:

```yaml
permissions:
  external:
    fetch:
      backend:
        - address: 'https://grpc.api.kentik.com'
```

Use the API URL for your Kentik region. Common options include:

- US: `https://grpc.api.kentik.com`
- EU: `https://grpc.api.kentik.eu`

If you change the external fetch address in `manifest.yml`, redeploy the app before installing or upgrading it.

## Deploy and Install

Deploy to the development environment:

```bash
forge deploy -e development
```

Install the app on a Jira site:

```bash
forge install --site https://your-site.atlassian.net --product jira --environment development
```

If the app is already installed and you changed scopes or permissions, upgrade the installation:

```bash
forge install --upgrade --site https://your-site.atlassian.net --product jira --environment development
```

## Configure the Integration

After deploying and installing the app, open the Jira admin page titled `Kentik API Integration Settings`.

To find the page for your site:

- Open your Jira site, for example `https://your-site.atlassian.net`.
- Go to site settings, then `Marketplace apps`.
- Under `Apps`, select `Kentik API Integration Settings`.

After you install the registered app on your Jira site, Jira will expose the settings page under that site's app settings area.

Configure the integration values:

- Kentik API URL for the same region allowed in `manifest.yml`, for example `https://grpc.api.kentik.com` or `https://grpc.api.kentik.eu`.
- Kentik Portal URL for your region, for example `https://portal.kentik.com`.
- Kentik user email.
- Kentik API token.
- Sync options for acknowledge, comments, and clear actions.

The API token is stored with Forge KVS secret storage. Do not commit API tokens or site-specific credentials to this repository.

## Authorization Model

This self-managed app uses the Kentik API credential configured by the Jira administrator. Actions performed through the app use that Kentik identity, even when different Jira users trigger those actions from Jira issues.

For that reason, use a dedicated least-privilege Kentik user for this integration. This should be a regular Kentik user reserved for the Jira integration, with only the Kentik permissions needed for the workflows you enable, such as AI investigations, alert comments, acknowledge/unacknowledge, and clear. If a workflow is not needed, leave the corresponding sync option disabled.

Jira permissions and project access still control who can view or interact with Jira issues, but they do not automatically map each Jira user to a distinct Kentik user. Administrators should limit access to the app and its related Jira workflows to trusted users whose Jira access is appropriate for the Kentik actions exposed by the configured credential.

## Jira Automation Deduplication

To keep one active Jira issue per Kentik alert when repeated alert state changes arrive, configure a Jira global automation rule. See [../../docs/jira-automation-deduplication.md](../../docs/jira-automation-deduplication.md).

## Jira Service Management Alert Deduplication

To create and deduplicate Jira Service Management Operations alerts instead of Jira issues, configure the Kentik JSM notification channel. See [../../docs/jsm-alert-deduplication.md](../../docs/jsm-alert-deduplication.md).

## Development

After running `forge register`, run lint checks:

```bash
npm run lint
forge lint
```

Use Forge tunnel for local development:

```bash
forge tunnel
```

If you change `manifest.yml`, redeploy before testing the new manifest configuration.

