import React, { useState, useEffect, useRef } from 'react';
import ForgeReconciler, { Box, Text, Heading, TextArea, Button, ProgressBar, Inline, Link, useProductContext, xcss, CodeBlock, List, ListItem, Code, Stack, Strong } from '@forge/react';
import { invoke, requestJira, view, router } from '@forge/bridge';

const dividerStyles = xcss({
  borderTopStyle: 'solid',
  borderTopWidth: 'border.width',
  borderTopColor: 'color.border',
  marginBlock: 'space.200',
});

const chatContainerStyles = xcss({
  maxHeight: '450px',
  overflowY: 'auto',
});

const tableContainerStyles = xcss({
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderColor: 'color.border',
  borderRadius: 'border.radius',
  overflowX: 'auto',
});

const tableCellStyles = xcss({
  padding: 'space.100',
  borderBottomStyle: 'solid',
  borderBottomWidth: 'border.width',
  borderBottomColor: 'color.border',
  flexGrow: 1,
  width: '0',
});

function renderMarkdownContent(text, baseUrl) {
  const lines = text.split('\n');
  const elements = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // --- Fenced code block ---
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim() || undefined;
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <CodeBlock 
          key={key++} 
          text={codeLines.join('\n')} 
          language={lang} 
          showLineNumbers={false}
          shouldWrapLongLines={true}
        />
      );
      continue;
    }

    // --- Headings ---
    if (line.startsWith('### ')) {
      elements.push(<Heading key={key++} size="small">{line.slice(4)}</Heading>);
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<Heading key={key++} size="medium">{line.slice(3)}</Heading>);
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(<Heading key={key++} size="large">{line.slice(2)}</Heading>);
      i++;
      continue;
    }

    // --- Horizontal rule ---
    if (/^---+$/.test(line.trim())) {
      elements.push(<Box key={key++} xcss={dividerStyles} />);
      i++;
      continue;
    }

    // --- Markdown table ---
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableRows = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        const row = lines[i].trim();
        // Skip separator rows like |---|---|
        if (!/^\|[-:\s|]+\|$/.test(row)) {
          const cells = row.split('|').slice(1, -1).map(c => c.trim());
          tableRows.push(cells);
        }
        i++;
      }
      if (tableRows.length > 0) {
        const headerCells = tableRows[0];
        const dataRows = tableRows.slice(1);
        elements.push(
          <Box key={key++} xcss={tableContainerStyles}>
            <Inline key="header" grow="fill">
              {headerCells.map((cell, idx) => (
                <Box key={idx} xcss={tableCellStyles}>
                  <Text weight="bold">{renderInlineFormatting(cell, baseUrl)}</Text>
                </Box>
              ))}
            </Inline>
            {dataRows.map((row, rowIdx) => (
              <Inline key={rowIdx} grow="fill">
                {row.map((cell, idx) => (
                  <Box key={idx} xcss={tableCellStyles}>
                    <Text>{renderInlineFormatting(cell, baseUrl)}</Text>
                  </Box>
                ))}
              </Inline>
            ))}
          </Box>
        );
      }
      continue;
    }

    // --- Unordered list (collect consecutive items + continuations) ---
    if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        let itemText = lines[i].slice(2);
        i++;
        while (i < lines.length && lines[i].match(/^\s+\S/) && !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i])) {
          itemText += ' ' + lines[i].trim();
          i++;
        }
        items.push(itemText);
      }
      elements.push(
        <List key={key++} type="unordered">
          {items.map((item, idx) => <ListItem key={idx}>{renderInlineFormatting(item, baseUrl)}</ListItem>)}
        </List>
      );
      continue;
    }

    // --- Ordered list (collect consecutive items + continuations) ---
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        let itemText = lines[i].replace(/^\d+\. /, '');
        i++;
        while (i < lines.length && lines[i].match(/^\s+\S/) && !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i])) {
          itemText += ' ' + lines[i].trim();
          i++;
        }
        items.push(itemText);
      }
      elements.push(
        <List key={key++} type="ordered">
          {items.map((item, idx) => <ListItem key={idx}>{renderInlineFormatting(item, baseUrl)}</ListItem>)}
        </List>
      );
      continue;
    }

    // --- Blank line (spacer) ---
    if (line.trim() === '') {
      i++;
      continue;
    }

    // --- Regular text paragraph ---
    elements.push(<Text key={key++}>{renderInlineFormatting(line, baseUrl)}</Text>);
    i++;
  }

  return <Stack space="space.100">{elements}</Stack>;
}

function getSafeHttpUrl(rawUrl, baseUrl) {
  const trimmedUrl = String(rawUrl || '').trim();
  if (!trimmedUrl) return null;

  try {
    if (trimmedUrl.startsWith('/') && !trimmedUrl.startsWith('//')) {
      if (!baseUrl) return null;
      const parsedBaseUrl = new URL(baseUrl);
      if (parsedBaseUrl.protocol !== 'http:' && parsedBaseUrl.protocol !== 'https:') return null;
      return new URL(trimmedUrl, parsedBaseUrl).href;
    }

    const parsedUrl = new URL(trimmedUrl);
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      return parsedUrl.href;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function renderInlineFormatting(text, baseUrl) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g);
  
  if (parts.length === 1) return text;

  return parts.map((part, idx) => {
    // Markdown link: [text](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const href = getSafeHttpUrl(linkMatch[2], baseUrl);
      if (!href) return linkMatch[1];
      return <Link key={idx} href={href} openNewTab={true}>{linkMatch[1]}</Link>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <Code key={idx}>{part.slice(1, -1)}</Code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Strong key={idx}>{part.slice(2, -2)}</Strong>;
    }
    return part;
  });
}

function markdownToAdf(text, baseUrl) {
  const lines = text.split('\n');
  const nodes = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // --- Fenced code block ---
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim() || undefined;
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      const attrs = lang ? { language: lang } : {};
      nodes.push({
        type: 'codeBlock',
        attrs,
        content: [{ type: 'text', text: codeLines.join('\n') }]
      });
      continue;
    }

    // --- Headings ---
    if (line.startsWith('### ')) {
      nodes.push({ type: 'heading', attrs: { level: 3 }, content: inlineToAdf(line.slice(4), baseUrl) });
      i++; continue;
    }
    if (line.startsWith('## ')) {
      nodes.push({ type: 'heading', attrs: { level: 2 }, content: inlineToAdf(line.slice(3), baseUrl) });
      i++; continue;
    }
    if (line.startsWith('# ')) {
      nodes.push({ type: 'heading', attrs: { level: 1 }, content: inlineToAdf(line.slice(2), baseUrl) });
      i++; continue;
    }

    // --- Horizontal rule ---
    if (/^---+$/.test(line.trim())) {
      nodes.push({ type: 'rule' });
      i++;
      continue;
    }

    // --- Markdown table ---
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableRows = [];
      let isFirstDataRow = true;
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        const row = lines[i].trim();
        // Skip separator rows like |---|---|
        if (!/^\|[-:\s|]+\|$/.test(row)) {
          const cells = row.split('|').slice(1, -1).map(c => c.trim());
          tableRows.push({ cells, isHeader: isFirstDataRow });
          isFirstDataRow = false;
        }
        i++;
      }
      if (tableRows.length > 0) {
        const adfRows = tableRows.map(row => ({
          type: 'tableRow',
          content: row.cells.map(cell => ({
            type: row.isHeader ? 'tableHeader' : 'tableCell',
            content: [{ type: 'paragraph', content: inlineToAdf(cell, baseUrl) }]
          }))
        }));
        nodes.push({
          type: 'table',
          attrs: { isNumberColumnEnabled: false, layout: 'default' },
          content: adfRows
        });
      }
      continue;
    }

    // --- Unordered list ---
    if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        let itemText = lines[i].slice(2);
        i++;
        while (i < lines.length && lines[i].match(/^\s+\S/) && !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i])) {
          itemText += ' ' + lines[i].trim();
          i++;
        }
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: inlineToAdf(itemText, baseUrl) }]
        });
      }
      nodes.push({ type: 'bulletList', content: items });
      continue;
    }

    // --- Ordered list ---
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        let itemText = lines[i].replace(/^\d+\. /, '');
        i++;
        while (i < lines.length && lines[i].match(/^\s+\S/) && !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i])) {
          itemText += ' ' + lines[i].trim();
          i++;
        }
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: inlineToAdf(itemText, baseUrl) }]
        });
      }
      nodes.push({ type: 'orderedList', content: items });
      continue;
    }

    // --- Blank line ---
    if (line.trim() === '') { i++; continue; }

    // --- Regular paragraph ---
    nodes.push({ type: 'paragraph', content: inlineToAdf(line, baseUrl) });
    i++;
  }

  return { version: 1, type: 'doc', content: nodes };
}

function inlineToAdf(text, baseUrl) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.filter(Boolean).map(part => {
    // Markdown link: [text](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const href = getSafeHttpUrl(linkMatch[2], baseUrl);
      if (!href) return { type: 'text', text: linkMatch[1] };
      return { type: 'text', text: linkMatch[1], marks: [{ type: 'link', attrs: { href } }] };
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return { type: 'text', text: part.slice(1, -1), marks: [{ type: 'code' }] };
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return { type: 'text', text: part.slice(2, -2), marks: [{ type: 'strong' }] };
    }
    return { type: 'text', text: part };
  });
}

function AiIssueActionModal() {
  const context = useProductContext(); 
  const pollIntervalRef = useRef(null);
  
  // Dynamic Configuration & Environment States
  const [kentikBaseUrl, setKentikBaseUrl] = useState(''); 
  const [userName, setUserName] = useState('Support Agent'); 
  
  // Persistent Chat Session Lifecycle States
  const [sessionId, setSessionId] = useState(null);
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState([]); 
  
  // Interactive UI Loading & Telemetry States
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [progressValue, setProgressValue] = useState(0.1);
  const [publishingIndex, setPublishingIndex] = useState(null); 

  // Smart Context Sync State
  const [hasCommented, setHasCommented] = useState(false);

  const getFormattedTimestamp = () => {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const clearPollInterval = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // 🌐 1. FETCH PORTAL URL FROM KVS STORAGE ON INITIAL MOUNT
  useEffect(() => {
    const fetchStorageConfig = async () => {
      try {
        const result = await invoke('getPortalUrl');
        if (result.success && result.portalUrl) {
          setKentikBaseUrl(result.portalUrl);
        }
      } catch (err) {
        console.error('Failed to pull portal URL from storage.');
      }
    };
    fetchStorageConfig();
  }, []);

  // 👤 2. FETCH LIVE USER PROFILE EFFECT
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const response = await requestJira('/rest/api/3/myself');
        const userData = await response.json();
        if (userData && userData.displayName) {
          setUserName(userData.displayName);
        }
      } catch (error) {
        console.error('Failed to resolve current Jira user profile metadata.');
      }
    };

    if (context) {
      fetchUserProfile();
    }
  }, [context]);

  // 🕒 3. LIVE TIME COUNTER LOOP EFFECT
useEffect(() => {
    let timer;

    if (loading) {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
        setProgressValue((curr) => (curr < 0.9 ? curr + 0.01 : curr));
      }, 1000);
    } else {
      setElapsedSeconds(0);
      setProgressValue(0.1);
    }

    return () => {
      clearInterval(timer);
    };
  }, [loading]);

  if (!context) {
    return (
      <Box padding="space.200">
        <Text>⏳ Initializing secure connection context...</Text>
      </Box>
    );
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleSendMessage = async () => {
    if (!currentPrompt.trim()) return;

    const userMsg = currentPrompt;
    setCurrentPrompt(''); 
    setLoading(true);
    
    setChatHistory((prev) => [...prev, { role: 'user', text: userMsg, time: getFormattedTimestamp() }]);

    const issueId = context?.extension?.issueId || 
                    context?.platformContext?.issueId || 
                    context?.extension?.issue?.id;

    try {
      let activeSessionId = sessionId;

      if (!activeSessionId) {
        setStatusMessage('Gathering Jira metadata context...');
        const jiraFieldsResponse = await requestJira(
          `/rest/api/3/issue/${issueId}?fields=summary,description&properties=kentik-alertId`
        );
        const issueData = await jiraFieldsResponse.json();
        
        const summaryText = issueData?.fields?.summary || 'No Summary Provided';
        let descriptionText = '';
        const adfParagraphs = issueData?.fields?.description?.content;
        if (adfParagraphs && Array.isArray(adfParagraphs)) {
          descriptionText = adfParagraphs
            .map(p => p.content?.map(t => t.text).join('') || '').join('\n');
        }

        let extractedAlertId = 'Not Provided';
        const alertIdProperty = issueData?.properties?.['kentik-alertId'];
        if (alertIdProperty) {
          extractedAlertId = alertIdProperty;
        }

        setStatusMessage('Initializing AI thread session...');
        const ticketData = { 
          issueId, summary: summaryText, description: descriptionText, 
          alertId: extractedAlertId
        };

        const startResult = await invoke('startAIInvestigation', {
          userPrompt: userMsg,
          issueContext: ticketData 
        });

        if (!startResult.success) throw new Error(startResult.error);
        activeSessionId = startResult.sessionId;
        setSessionId(activeSessionId);
      } 
      else {
        setStatusMessage('Sending follow-up prompt to active session thread...');
        
        const followUpResult = await invoke('sendAIFollowUp', {
          sessionId: activeSessionId,
          userPrompt: userMsg
        });

        if (!followUpResult.success) throw new Error(followUpResult.error);
      }

      setStatusMessage('AI is generating response...');
      const startTime = Date.now();
      clearPollInterval();
      
      pollIntervalRef.current = setInterval(async () => {
        if (Date.now() - startTime > 300000) { 
          clearPollInterval();
          setLoading(false);
          setChatHistory((prev) => [...prev, { role: 'ai', text: '❌ Error: Safety timeout reached (5 Mins).', time: getFormattedTimestamp() }]);
          return;
        }

        let result;
        try {
          result = await invoke('checkAIStatus', { sessionId: activeSessionId });
        } catch (error) {
          result = { success: false, error: error.message || 'Status check failed unexpectedly.' };
        }

        if (!result.success) {
          clearPollInterval();
          setLoading(false);
          setChatHistory((prev) => [...prev, { role: 'ai', text: `❌ Network tracing drop: ${result.error}`, time: getFormattedTimestamp() }]);
          return;
        }

        if (result.isComplete) {
          clearPollInterval();
          setLoading(false);
          setStatusMessage('');
          
          if (result.hasError) {
            setChatHistory((prev) => [...prev, { role: 'ai', text: `❌ Engine error: ${result.error}`, time: getFormattedTimestamp() }]);
          } else {
            setChatHistory((prev) => [...prev, { role: 'ai', text: result.aiOutput, time: getFormattedTimestamp() }]);
          }
        } else {
          setStatusMessage(result.statusMessage || 'AI agent is actively processing...');
        }
      }, 3000);

    } catch (error) {
      setLoading(false);
      setStatusMessage('');
      setChatHistory((prev) => [...prev, { role: 'ai', text: `❌ Failure: ${error.message}`, time: getFormattedTimestamp() }]);
    }
  };

  const handlePostComment = async (textToPost, index) => {
    setPublishingIndex(index);
    const issueId = context?.extension?.issueId || context?.platformContext?.issueId || context?.extension?.issue?.id;

    try {
      const jiraResponse = await requestJira(`/rest/api/3/issue/${issueId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: markdownToAdf(textToPost, kentikBaseUrl),
          properties: [
            {
              key: 'kentik-origin',
              value: {
                source: 'kentik-ai-investigation'
              }
            }
          ]
        })
      });

      if (jiraResponse.ok) {
        setHasCommented(true); 

        setChatHistory((prev) => {
          const updated = [...prev];
          updated[index].text = updated[index].text + '\n\n✅ (Sent to Ticket Comments)';
          return updated;
        });
      }
    } catch (err) {
      console.error('Failed to post AI response as a Jira comment.');
    } finally {
      setPublishingIndex(null);
    }
  };

  const handleExitSession = async () => {
    if (hasCommented) {
      await router.reload(); 
    } else {
      view.close(); 
    }
  };

  const kentikAiSessionUrl = sessionId && kentikBaseUrl
    ? getSafeHttpUrl(`/v4/core/ai-advisor/${sessionId}`, kentikBaseUrl)
    : null;

  return (
    <Box padding="space.300">
      
      {/* HEADER SECTION */}
      <Box marginBottom="space.300" padding="space.100">
        <Heading size="small">✨ Kentik AI Session</Heading>
      </Box>

      {/* 📜 1. TIMELINE STREAM LOG PANEL */}
      <Box marginBottom="space.400" xcss={chatContainerStyles}>
        {chatHistory.length === 0 ? (
          <Box backgroundColor="elevation.surface" paddingBlock="space.1000" padding="space.300" borderRadius="normal">
            <Text color="color.text.subtle" align="center">
              No conversation history yet. Type an initial instruction below to initiate a Kentik AI session.
            </Text>
          </Box>
        ) : (
          chatHistory.map((message, idx) => (
            <Box 
              key={idx} 
              padding="space.200" 
              marginBottom="space.150" 
              borderRadius="normal"
              backgroundColor={message.role === 'user' ? 'elevation.surface.raised' : 'elevation.surface.hovered'}
            >
              <Inline spread="space-between" grow="fill" alignBlock="center">
                <Text weight="medium">
                  {message.role === 'user' ? `👤 ${userName}` : '🧠 Kentik AI'}
                </Text>
                <Text size="small" color="color.text.subtle">
                  {message.time}
                </Text>
              </Inline>
              
              <Box marginTop="space.100" marginBottom="space.050">
                {message.role === 'ai' 
                  ? renderMarkdownContent(message.text, kentikBaseUrl)
                  : <Text>{message.text}</Text>
                }
              </Box>
              
              {message.role === 'ai' && !message.text.startsWith('❌') && (
                <Box marginTop="space.150">
                  <Button 
                    appearance="primary" 
                    spacing="none"
                    onClick={() => handlePostComment(message.text, idx)}
                    isDisabled={publishingIndex !== null}
                  >
                    {publishingIndex === idx ? 'Publishing comment...' : '📥 Send to ticket comments'}
                  </Button>
                </Box>
              )}
            </Box>
          ))
        )}
      </Box>

      {/* 🧠 2. TIMING PROGRESS TRACKER CONTAINER WITH LIVE JOKES */}
      {loading && (
        <Box padding="space.200" backgroundColor="elevation.surface" borderRadius="normal" marginTop="space.200">
          <ProgressBar value={progressValue} isIndeterminate={progressValue === 0.1} />
          
          <Box marginTop="space.150" marginBottom="space.100">
            <Inline spread="space-between" grow="fill" alignBlock="center">
              <Text color="color.text.subtle" size="small">⏳ {statusMessage}</Text>
              <Text weight="bold" color="color.text.accent.blue" size="small">⏱️ Running: {formatTime(elapsedSeconds)}</Text>
            </Inline>
          </Box>
        </Box>
      )}

      {/* Divider between chat and input */}
      <Box xcss={dividerStyles} />

      {/* ⌨️ 3. LOWER OPERATION FORMS CONTROL BAR */}
      <Box>
        <TextArea
          name="chatPromptInput"
          placeholder={sessionId ? "Ask a follow-up question (i.e. summarize answer)" : "What should Kentik AI analyze first? (i.e. what's the root cause of this alert?)"}
          value={currentPrompt}
          onChange={(e) => setCurrentPrompt(e.target.value)}
          isDisabled={loading}
        />
        
        <Box marginTop="space.200">
          <Inline spread="space-between" alignBlock="center" grow="fill">
            <Inline space="space.100">
              <Button appearance="primary" onClick={handleSendMessage} isDisabled={loading || !currentPrompt.trim()}>
                {sessionId ? 'Send Follow-up' : 'Ask Kentik AI'}
              </Button>
              <Button appearance="subtle" onClick={handleExitSession} isDisabled={loading}>
                Exit Session
              </Button>
            </Inline>

            {/* 🔗 4. GROUNDED REDIRECT FOOTER LINK */}
            {kentikAiSessionUrl && (
              <Box padding="space.050">
                <Text>
                  <Link href={kentikAiSessionUrl} openNewTab={true}>
                    View full session in Kentik ↗️
                  </Link>
                </Text>
              </Box>
            )}
          </Inline>
        </Box>
      </Box>

    </Box>
  );
}

ForgeReconciler.render(<AiIssueActionModal />);