import api, { fetch, route } from '@forge/api';
import Resolver from '@forge/resolver';
import { kvs } from '@forge/kvs'; 

const resolver = new Resolver();
const LINKED_ALERT_LOOKUP_CONCURRENCY = 5;
const LINKED_ALERT_POLL_ATTEMPTS = 6;
const LINKED_ALERT_POLL_INTERVAL_MS = 2000;
const KENTIK_COMMENT_ORIGIN_PROPERTY = 'kentik-origin';
const COMMENT_ORIGIN_PROPERTY_POLL_ATTEMPTS = 6;
const COMMENT_ORIGIN_PROPERTY_POLL_INTERVAL_MS = 500;
const ISSUE_FIELD_POLL_ATTEMPTS = 6;
const ISSUE_FIELD_POLL_INTERVAL_MS = 500;

function logError(message, error) {
    const errorName = error?.name ? ` ${error.name}` : '';
    console.error(`${message}${errorName}`);
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function extractCommentText(commentBody) {
    if (typeof commentBody === 'string') return commentBody;
    if (!commentBody) return '';

    const textFragments = [];
    const collectText = node => {
        if (!node) return;
        if (node.type === 'text' && node.text) textFragments.push(node.text);
        if (Array.isArray(node.content)) node.content.forEach(collectText);
    };

    collectText(commentBody);
    return textFragments.join(' ');
}

async function isKentikOriginComment(comment) {
    if (!comment?.id) return false;

    const payloadProperties = Array.isArray(comment.properties) ? comment.properties : [];
    if (payloadProperties.some(property => property?.key === KENTIK_COMMENT_ORIGIN_PROPERTY)) {
        console.log("Ignored: Comment originated from Kentik integration. Skipping comment mirroring.");
        return true;
    }

    for (let attempt = 1; attempt <= COMMENT_ORIGIN_PROPERTY_POLL_ATTEMPTS; attempt++) {
        try {
            const propertyResponse = await api.asApp().requestJira(
                route`/rest/api/3/comment/${comment.id}/properties/${KENTIK_COMMENT_ORIGIN_PROPERTY}`
            );

            if (propertyResponse.status === 200) {
                console.log("Ignored: Comment originated from Kentik integration. Skipping comment mirroring.");
                return true;
            }

            if (propertyResponse.status !== 404) {
                console.log(`Comment origin property lookup returned status ${propertyResponse.status}.`);
                return false;
            }
        } catch (error) {
            logError("Unable to inspect comment origin property.", error);
            return false;
        }

        if (attempt < COMMENT_ORIGIN_PROPERTY_POLL_ATTEMPTS) {
            await wait(COMMENT_ORIGIN_PROPERTY_POLL_INTERVAL_MS);
        }
    }

    return false;
}

async function fetchLinkedAlertUuids(cloudId, issueId) {
    const jsmResponse = await api.asApp().requestJira(
        route`/jsm/incidents/cloudId/${cloudId}/v1/incident/${issueId}/alert`
    );

    if (jsmResponse.status !== 200) {
        console.log(`Linked alert lookup returned status ${jsmResponse.status}.`);
        return [];
    }

    const jsmData = await jsmResponse.json();
    return jsmData.values?.alertIds || [];
}

async function getLinkedAlertUuids({ cloudId, issueId, waitForLinkedAlerts }) {
    const attempts = waitForLinkedAlerts ? LINKED_ALERT_POLL_ATTEMPTS : 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const alertUuids = await fetchLinkedAlertUuids(cloudId, issueId);
        if (alertUuids.length > 0 || attempt === attempts) {
            return alertUuids;
        }

        console.log(`No linked native alerts discovered yet; retrying lookup ${attempt + 1}/${attempts}.`);
        await wait(LINKED_ALERT_POLL_INTERVAL_MS);
    }

    return [];
}

async function getIssueAlertIdProperty(issueKey) {
    try {
        const propResponse = await api.asApp().requestJira(
            route`/rest/api/3/issue/${issueKey}/properties/kentik-alertId`
        );

        if (propResponse.status === 200) {
            const propData = await propResponse.json();
            return propData.value || null;
        }
    } catch (err) {
        console.log("Direct property lookup bypassed.");
    }

    return null;
}

async function setIssueAlertIdProperty(issueKey, alertId) {
    try {
        const propResponse = await api.asApp().requestJira(
            route`/rest/api/3/issue/${issueKey}/properties/kentik-alertId`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(alertId)
            }
        );

        if (propResponse.status === 200 || propResponse.status === 201 || propResponse.status === 204) {
            console.log("🎯 Kentik alert metadata promoted to issue property for AI action visibility.");
            return;
        }

        console.log(`Kentik alert metadata issue property update returned status ${propResponse.status}.`);
    } catch (err) {
        logError("Unable to promote Kentik alert metadata to issue property.", err);
    }
}

async function addAlertIdFromSummaryFallback({ issueKey, validAlertIds, alertId, source, shouldPromoteIssueProperty }) {
    if (!alertId) return false;

    validAlertIds.push(alertId);
    console.log(`🎯 Kentik alert metadata target loaded from ${source}.`);
    if (shouldPromoteIssueProperty) {
        await setIssueAlertIdProperty(issueKey, alertId);
    }
    return true;
}

function getKentikAlertIdFromIssueSummary(fields = {}) {
    const labels = Array.isArray(fields.labels) ? fields.labels : [];
    const hasKentikLabel = labels.some(label => String(label).toLowerCase() === 'kentik');
    if (!hasKentikLabel) return null;

    const summary = String(fields.summary || '');
    const alertIdMatch = summary.match(/\[\s*(?:\\?["'])?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\\?["'])?\s*\]\s*$/i);
    if (!alertIdMatch) return null;

    const alertId = alertIdMatch[1].trim();
    return alertId || null;
}

async function fetchIssueSummaryFields(issueKey) {
    const issueResponse = await api.asApp().requestJira(
        route`/rest/api/3/issue/${issueKey}?fields=summary,labels`
    );

    if (issueResponse.status !== 200) {
        console.log(`Issue summary field lookup returned status ${issueResponse.status}.`);
        return null;
    }

    const issueData = await issueResponse.json();
    return issueData.fields || null;
}

async function getKentikAlertIdFromCurrentIssueFields(issueKey, { waitForIssueFields }) {
    const attempts = waitForIssueFields ? ISSUE_FIELD_POLL_ATTEMPTS : 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const fields = await fetchIssueSummaryFields(issueKey);
            const alertId = getKentikAlertIdFromIssueSummary(fields || {});
            if (alertId || attempt === attempts) return alertId;
        } catch (error) {
            logError("Unable to inspect current issue summary fields.", error);
            return null;
        }

        await wait(ISSUE_FIELD_POLL_INTERVAL_MS);
    }

    return null;
}

async function resolveLinkedAlertAlarmId(alertUuid) {
    try {
        console.log("🔍 Requesting metadata packet for native alert asset.");

        const alertPropResponse = await api.asApp().requestJira(
            route`/jsm/ops/api/v1/alerts/${alertUuid}`
        );

        if (alertPropResponse.status === 200) {
            const alertAssetData = await alertPropResponse.json();
            const alarmId = alertAssetData.details?.["Alarm ID"];
            if (alarmId) {
                console.log("🎯 Successfully isolated linked alert identifier.");
                return alarmId;
            }
            return null;
        }

        if (alertPropResponse.status === 403) {
            console.log("❌ Linked alert metadata request returned 403 due to the current Atlassian Forge/JSM Ops API limitation tracked in JSDCLOUD-18783.");
        } else {
            console.log(`❌ Linked alert metadata request rejected. Status: ${alertPropResponse.status}`);
        }
    } catch (propErr) {
        logError("❌ Linked alert metadata lookup failed.", propErr);
    }

    return null;
}

resolver.define('getSettings', async (req) => {
    try {
        // Restored to your original storage keys
        const apiUrl = await kvs.get('api_url') || '';
        const portalUrl = await kvs.get('portal_url') || ''; 
        const adminEmail = await kvs.get('admin_email') || '';
        const apiToken = await kvs.getSecret('api_token') || ''; 

        // Feature flags defaults
        const syncAck = await kvs.get('sync_ack') ?? false;
        const syncComments = await kvs.get('sync_comments') ?? false;
        const syncClear = await kvs.get('sync_clear') ?? false;

        return { 
            apiUrl,
            portalUrl, 
            adminEmail, 
            isTokenSet: !!apiToken,
            syncAck,
            syncComments,
            syncClear
        };
    } catch (err) {
        logError("Error in getSettings.", err);
        return { apiUrl: '', adminEmail: '', isTokenSet: false, syncAck: false, syncComments: false, syncClear: false };
    }
});

resolver.define('saveSettings', async (req) => {
    try {
        const { api_url, portal_url, api_token, admin_email, sync_ack, sync_comments, sync_clear } = req.payload;
        
        // Restored to your original storage keys
        await kvs.set('api_url', String(api_url || '').trim());
        await kvs.set('portal_url', String(portal_url || '').trim());
        await kvs.set('admin_email', String(admin_email || '').trim());
        
        await kvs.set('sync_ack', Boolean(sync_ack));
        await kvs.set('sync_comments', Boolean(sync_comments));
        await kvs.set('sync_clear', Boolean(sync_clear));
        
        if (api_token && api_token.trim() !== '') {
            await kvs.setSecret('api_token', String(api_token).trim());
        }
        
        return { success: true };
    } catch (err) {
        logError("❌ Critical exception during saveSettings.", err);
        return { success: false, error: err.message };
    }
});

const aiResolver = new Resolver();
  aiResolver.define('getPortalUrl', async () => {
    try {
        const savedUrl = await kvs.get('portal_url')
      
      return { 
        success: true, 
        portalUrl: savedUrl && savedUrl.trim() !== '' ? savedUrl.trim() : null 
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

aiResolver.define('startAIInvestigation', async (req) => {
    const { userPrompt, issueContext } = req.payload;
  
    const apiUrl = await kvs.get('api_url');
    const apiToken = await kvs.getSecret('api_token');
    const apiEmail = await kvs.get('admin_email');

    if (!apiUrl || !apiToken || !apiEmail) {
        const error = 'Kentik integration credentials are not configured. Configure API URL, email, and token in the admin page.';
         console.error('Kentik integration credentials are not configured.');
         return { success: false, error };
        return;
    }

    const combinedPromptPayload = `
[USER QUESTION/COMMAND]

${userPrompt}

[CONTEXT METADATA]

Summary/Headline: ${issueContext.summary}

Alert ID: ${issueContext.alertId}

Raw Description Content: ${issueContext.description}
    `.trim();
  
    try {
        const baseEndpoint = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
        const response = await fetch(`${baseEndpoint}/ai_advisor/v202511/chat`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'x-ch-auth-api-token': apiToken,
              'x-ch-auth-email': apiEmail
          },
          body: JSON.stringify({
              prompt: combinedPromptPayload 
            })
        });
  
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      
      const data = await response.json();
      return { success: true, sessionId: data.id };
  
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  

  aiResolver.define('checkAIStatus', async (req) => {
    const { sessionId } = req.payload;
  
    const apiUrl = await kvs.get('api_url');
    const apiToken = await kvs.getSecret('api_token');
    const apiEmail = await kvs.get('admin_email');

    if (!apiUrl || !apiToken || !apiEmail) {
        const error = 'Kentik integration credentials are not configured. Configure API URL, email, and token in the admin page.';
         console.error('Kentik integration credentials are not configured.');
         return { success: false, error };
        return;
    }

    try {
      const baseEndpoint = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
      const response = await fetch(`${baseEndpoint}/ai_advisor/v202511/chat/${sessionId}`, {
        method: 'GET',
          headers: {
              'Content-Type': 'application/json',
              'x-ch-auth-api-token': apiToken,
              'x-ch-auth-email': apiEmail
          },
      });
  
      if (!response.ok) throw new Error(`Status check failed: ${response.status}`);
      
      const chatSession = await response.json(); 
  
      // 1. Evaluate top-level SessionStatus enum string or integer value
      if (chatSession.status === 'SESSION_STATUS_PROCESSING' || chatSession.status === 'SESSION_STATUS_PENDING' || chatSession.status === 2 || chatSession.status === 1) {
        return { success: true, isComplete: false, statusMessage: 'Kentik AI is thinking...' };
      }
  
      if (chatSession.status === 'SESSION_STATUS_FAILED' || chatSession.status === 4) {
        return { success: true, isComplete: true, hasError: true, error: 'Session execution hit a structural engine fault.' };
      }
  
      if (chatSession.status === 'SESSION_STATUS_COMPLETED' || chatSession.status === 3) {
        // 2. Extract the message array block
        const messages = chatSession.messages || [];
        if (messages.length === 0) {
          return { success: true, isComplete: true, hasError: true, error: 'Session completed but message logs were empty.' };
        }
  
        // 3. Target the most current chat entry block
        const latestMessage = messages[messages.length - 1];
  
        // 4. Return the explicit markdown string inside optional string final_answer = 3
        return { 
          success: true, 
          isComplete: true, 
          hasError: false,
          aiOutput: latestMessage.final_answer || latestMessage.finalAnswer|| 'No explicit answer string generated.'
        };
      }
  
      return { success: true, isComplete: false, statusMessage: 'Awaiting upstream pipeline initialization...' };
  
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  aiResolver.define('sendAIFollowUp', async (req) => {
    const { sessionId, userPrompt } = req.payload;
  
    const apiUrl = await kvs.get('api_url');
    const apiToken = await kvs.getSecret('api_token');
    const apiEmail = await kvs.get('admin_email');

    if (!apiUrl || !apiToken || !apiEmail) {
        const error = 'Kentik integration credentials are not configured. Configure API URL, email, and token in the admin page.';
         console.error('Kentik integration credentials are not configured.');
         return { success: false, error };
        return;
    }

    // Exact payload mapping requirement requested
    const putPayload = { 
      id: sessionId, 
      prompt: userPrompt 
    };
  
    try {
        const baseEndpoint = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
        const response = await fetch(`${baseEndpoint}/ai_advisor/v202511/chat`, {
        method: 'PUT', // 👈 Invoked via PUT call specification mapping rules
          headers: {
              'Content-Type': 'application/json',
              'x-ch-auth-api-token': apiToken,
              'x-ch-auth-email': apiEmail
          },
        body: JSON.stringify(putPayload)
      });
  
      if (!response.ok) {
        throw new Error(`API returned execution error status: ${response.status}`);
      }
  
      // Return success to kick off the frontend's status check interval
      return { success: true };
  
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  export const aiHandler = aiResolver.getDefinitions();
  
// ============================================================================
// SHARED HELPERS
// ============================================================================

async function collectAlertIds(event, context, { waitForLinkedAlerts = false } = {}) {
    const issueKey = event.issue.key;
    const issueTypeName = event.issue.fields?.issuetype?.name;
    const validAlertIds = [];

    const alertIdProperty = await getIssueAlertIdProperty(issueKey);
    if (alertIdProperty) {
        validAlertIds.push(alertIdProperty);
        console.log("🎯 Standalone alert metadata target loaded.");
    }
    const shouldPromoteIssueProperty = !alertIdProperty;

    const summaryAlertId = validAlertIds.length === 0 ? getKentikAlertIdFromIssueSummary(event.issue.fields) : null;
    await addAlertIdFromSummaryFallback({
        issueKey,
        validAlertIds,
        alertId: summaryAlertId,
        source: 'labeled issue summary',
        shouldPromoteIssueProperty
    });

    const currentSummaryAlertId = validAlertIds.length === 0
        ? await getKentikAlertIdFromCurrentIssueFields(issueKey, { waitForIssueFields: waitForLinkedAlerts })
        : null;
    await addAlertIdFromSummaryFallback({
        issueKey,
        validAlertIds,
        alertId: currentSummaryAlertId,
        source: 'current labeled issue summary',
        shouldPromoteIssueProperty
    });

    // Path B: Batch Parse Native JSM Operations Linked Alerts
    if (validAlertIds.length === 0 && (issueTypeName === "Incident" || issueTypeName === "[System] Incident")) {
        try {
            const cloudId = context.installContext.split('/').pop();
            const issueId = event.issue.id;

            console.log("🔍 Querying JSM Operations API for linked alerts on incident.");
            const jsmAlertUuids = await getLinkedAlertUuids({ cloudId, issueId, waitForLinkedAlerts });

            console.log(`Discovered ${jsmAlertUuids.length} linked native alerts. Resolving properties for each...`);

            for (let startIndex = 0; startIndex < jsmAlertUuids.length; startIndex += LINKED_ALERT_LOOKUP_CONCURRENCY) {
                const alertUuidBatch = jsmAlertUuids.slice(startIndex, startIndex + LINKED_ALERT_LOOKUP_CONCURRENCY);
                const batchAlarmIds = await Promise.all(alertUuidBatch.map(resolveLinkedAlertAlarmId));
                validAlertIds.push(...batchAlarmIds.filter(Boolean));
            }
        } catch (linkErr) {
            logError("Critical failure batch parsing JSM Operations records.", linkErr);
        }
    }

    return validAlertIds;
}

async function getKentikCredentials() {
    const apiUrl = await kvs.get('api_url');
    const apiToken = await kvs.getSecret('api_token');
    const apiEmail = await kvs.get('admin_email');

    if (!apiUrl || !apiToken || !apiEmail) {
        return null;
    }

    const baseEndpoint = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
    return { apiToken, apiEmail, apiVersionPath: `${baseEndpoint}/v202505/alerts` };
}

function getJiraIssueUrlFromSelfUrl(selfUrl, issueKey) {
    if (!selfUrl || !selfUrl.includes('/rest/api/') || selfUrl.startsWith('https://api.atlassian.com/')) {
        return null;
    }

    return `${selfUrl.split('/rest/api/')[0]}/browse/${issueKey}`;
}

async function getJiraIssueUrl(event, issueKey) {
    const selfUrlCandidates = [
        event.issue?.self,
        event.issue?.fields?.project?.self,
        event.issue?.fields?.issuetype?.self,
        event.issue?.fields?.status?.self
    ];

    for (const selfUrl of selfUrlCandidates) {
        const issueUrl = getJiraIssueUrlFromSelfUrl(selfUrl, issueKey);
        if (issueUrl) {
            console.log("Resolved Jira issue URL from trigger payload field URL.");
            return issueUrl;
        }
    }

    console.log("Issue created event did not include a usable site self URL; resolving site URL via Jira serverInfo.");

    try {
        const serverInfoResponse = await api.asApp().requestJira(
            route`/rest/api/3/serverInfo`
        );

        console.log(`Jira serverInfo lookup returned status ${serverInfoResponse.status}.`);

        if (serverInfoResponse.status === 200) {
            const serverInfo = await serverInfoResponse.json();
            if (serverInfo.baseUrl) {
                const issueUrl = `${String(serverInfo.baseUrl).replace(/\/$/, '')}/browse/${issueKey}`;
                console.log("Resolved Jira issue URL from serverInfo.");
                return issueUrl;
            }
            console.log("Jira serverInfo lookup did not include baseUrl.");
        }
    } catch (error) {
        logError("Unable to resolve Jira issue URL.", error);
    }

    return null;
}

async function dispatchToKentik({ alertIds, method, buildRequest }) {
    const creds = await getKentikCredentials();
    if (!creds) {
        const error = 'Kentik integration credentials are not configured. Configure API URL, email, and token in the admin page.';
         console.error('Kentik integration credentials are not configured.');
         return { success: false, error };
        return;
    }

    for (const targetAlertId of alertIds) {
        const { url, body } = buildRequest(targetAlertId, creds.apiVersionPath);
        if (!url) continue;

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'x-ch-auth-api-token': creds.apiToken,
                    'x-ch-auth-email': creds.apiEmail
                },
                body: JSON.stringify(body)
            });
            console.log(`🚀 Kentik request completed. Status: ${response.status}`);
        } catch (error) {
            logError("Link failure posting metric updates to Kentik.", error);
        }
    }
}

// ============================================================================
// HANDLER: Issue Created — Set External Context on Kentik Alert
// ============================================================================

export async function handleIssueCreated(event, context) {
    console.log("🆕 ISSUE CREATED EVENT: Processing new issue for external context sync...");

    if (!event?.issue || !event.issue.key) return;
    const issueKey = event.issue.key;

    const validAlertIds = await collectAlertIds(event, context, { waitForLinkedAlerts: true });
    if (validAlertIds.length === 0) {
        console.log("Ignored: No qualified Kentik tracking properties found. Skipping external context.");
        return;
    }

    const issueUrl = await getJiraIssueUrl(event, issueKey);
    const payload = {
        context: {
            jira_cloud: {
                issue_key: issueKey
            }
        }
    };

    if (issueUrl) {
        payload.context.jira_cloud.issue_url = issueUrl;
    } else {
        console.log("Issue URL unavailable; sending external context with issue key only.");
    }

    console.log(`📤 Setting external context for ${validAlertIds.length} alert(s).`);

    await dispatchToKentik({
        alertIds: validAlertIds,
        method: 'PUT',
        buildRequest: (alertId, apiVersionPath) => ({
            url: `${apiVersionPath}/${alertId}/external-context`,
            body: payload
        })
    });
}

// ============================================================================
// HANDLER: Issue Updated/Commented — Sync status and comments to Kentik
// ============================================================================

export async function handleEvent(event, context) {
    console.log("🔥 PRODUCT TRIGGER EVENT INTERCEPTED: Processing issue change event...");

    if (!event?.issue || !event.issue.key) return;
    const issueKey = event.issue.key;

    const validAlertIds = await collectAlertIds(event, context);
    if (validAlertIds.length === 0) {
        console.log("Ignored: No qualified Kentik tracking properties found. Aborting routing sequence.");
        return;
    }

    console.log(`✅ Identification Confirmed: Found ${validAlertIds.length} alert metadata target(s). Proceeding to event evaluation.`);

    // ============================================================================
    // EVALUATE THE LIFECYCLE ACTION
    // ============================================================================
    let actionType = null;
    let commonPayloadBody = {};

    // A. Evaluate Status Transitions
    if (event.changelog && event.changelog.items) {
        for (const item of event.changelog.items) {
            if (item.field === "status") {
                if (item.toString === "In Progress" || item.toString === "Acknowledged" || item.toString === "Investigating") {
                    actionType = 'ack';
                    commonPayloadBody = {
                        actorName: event.user ? event.user.displayName : "Jira Agent",
                        timestamp: new Date().toISOString()
                    };
                }
                else if (item.toString === "To Do" || item.toString === "Backlog" || item.toString === "Unacknowledged") {
                    actionType = 'unack';
                    commonPayloadBody = {
                        actorName: event.user ? event.user.displayName : "Jira Agent",
                        timestamp: new Date().toISOString()
                    };
                }
                else if (item.toString === "Done" || item.toString === "Resolved" || item.toString === "Closed") {
                    actionType = 'clear';
                }
            }
        }
    }

    // B. Evaluate Comment Additions
    if (!actionType && event.comment) {
        if (await isKentikOriginComment(event.comment)) return;

        actionType = 'comment';
        const extractedRawText = extractCommentText(event.comment.body);

        commonPayloadBody = {
            text: extractedRawText || "New comment synchronization event.",
            actorName: event.user ? event.user.displayName : "Jira Agent",
            timestamp: new Date().toISOString()
        };
    }

    if (!actionType) {
        console.log("Ignored: Target alerts exist, but the event was not a tracked status transition or comment.");
        return;
    }

    // ============================================================================
    // DISPATCH
    // ============================================================================
    const syncAckEnabled = await kvs.get('sync_ack') ?? false;
    const syncCommentsEnabled = await kvs.get('sync_comments') ?? false;
    const syncClearEnabled = await kvs.get('sync_clear') ?? false;

    await dispatchToKentik({
        alertIds: validAlertIds,
        method: 'POST',
        buildRequest: (targetAlertId, apiVersionPath) => {
            if (actionType === 'ack') {
                if (!syncAckEnabled) {
                    console.log("Bypassed: Acknowledge sync disabled by user. Skipping alert.");
                    return { url: null, body: null };
                }
                return { url: `${apiVersionPath}/${targetAlertId}/ack`, body: commonPayloadBody };
            } else if (actionType === 'unack') {
                if (!syncAckEnabled) {
                    console.log("Bypassed: Un-Acknowledge sync disabled by user. Skipping alert.");
                    return { url: null, body: null };
                }
                return { url: `${apiVersionPath}/${targetAlertId}/unack`, body: commonPayloadBody };
            } else if (actionType === 'comment') {
                if (!syncCommentsEnabled) {
                    console.log("Bypassed: Comment mirroring disabled by user. Skipping alert.");
                    return { url: null, body: null };
                }
                return { url: `${apiVersionPath}/${targetAlertId}/comments`, body: commonPayloadBody };
            } else if (actionType === 'clear') {
                if (!syncClearEnabled) {
                    console.log("Bypassed: Alert Clearing sync disabled by user. Skipping alert.");
                    return { url: null, body: null };
                }
                return { url: `${apiVersionPath}/clear`, body: { alert_ids: [targetAlertId] } };
            }
            return { url: null, body: null };
        }
    });
}

export const handler = resolver.getDefinitions();