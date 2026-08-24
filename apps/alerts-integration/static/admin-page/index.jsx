import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Textfield, Button, Form, FormSection, FormFooter, Box, Heading, Toggle } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
    const [settings, setSettings] = useState(null);
    const [saveStatus, setSaveStatus] = useState(null);
    
    const [apiUrl, setApiUrl] = useState('');
    const [portalUrl, setPortalUrl] = useState('');
    const [adminEmail, setAdminEmail] = useState('');
    const [apiToken, setApiToken] = useState('');

    const [syncAck, setSyncAck] = useState(false);
    const [syncComments, setSyncComments] = useState(false);
    const [syncClear, setSyncClear] = useState(false);

    const loadSettings = () => {
        invoke('getSettings').then((data) => {
            setSettings(data);
            setApiUrl(data.apiUrl || '');
            setPortalUrl(data.portalUrl || '');
            setAdminEmail(data.adminEmail || '');
            setApiToken('');
            setSyncAck(data.syncAck || false);
            setSyncComments(data.syncComments || false);
            setSyncClear(data.syncClear || false);
        });
    };

    useEffect(() => {
        loadSettings();
    }, []);

    if (!settings) {
        return <Text>Loading Kentik configuration...</Text>;
    }

    const handleSave = async () => {
        setSaveStatus('saving');
        
        const payload = {
            api_url: apiUrl,
            portal_url: portalUrl,
            admin_email: adminEmail,
            api_token: apiToken,
            sync_ack: syncAck,
            sync_comments: syncComments,
            sync_clear: syncClear
        };

        const response = await invoke('saveSettings', payload);
        
        if (response && response.success) {
            setSaveStatus('success');
            loadSettings(); 
        } else {
            setSaveStatus('error');
        }

        setTimeout(() => setSaveStatus(null), 4000);
    };

    return (
        <Box padding="space.200">
            {saveStatus === 'success' && (
                <Box backgroundColor="color.background.success" padding="space.150" borderRadius="normal" marginBlock="space.150">
                    <Text color="color.text.inverse">Success: Integration configuration saved and updated securely!</Text>
                </Box>
            )}
            {saveStatus === 'error' && (
                <Box backgroundColor="color.background.danger" padding="space.150" borderRadius="normal" marginBlock="space.150">
                    <Text color="color.text.inverse">Error: Failed to save settings. Please check app logs.</Text>
                </Box>
            )}
           
            <Form onSubmit={handleSave}>
                <FormSection>
                    <Box paddingBlock="space.100">
                        <Box marginBlockEnd="space.050">
                            <Heading size="xsmall">Kentik API URL</Heading>
                        </Box>
                        <Textfield 
                            name="api_url" 
                            value={apiUrl} 
                            onChange={(e) => setApiUrl(e.target.value)}
                            placeholder="https://grpc.api.kentik.com" 
                        />
                    </Box>

                    <Box paddingBlock="space.100">
                        <Box marginBlockEnd="space.050">
                            <Heading size="xsmall">Kentik Portal URL</Heading>
                        </Box>
                        <Textfield 
                            name="portal_url" 
                            value={portalUrl} 
                            onChange={(e) => setPortalUrl(e.target.value)}
                            placeholder="https://portal.kentik.com" 
                        />
                    </Box>

                    <Box paddingBlock="space.100">
                        <Box marginBlockEnd="space.050">
                            <Heading size="xsmall">Kentik User Email</Heading>
                        </Box>
                        <Textfield 
                            name="admin_email" 
                            value={adminEmail} 
                            onChange={(e) => setAdminEmail(e.target.value)}
                            placeholder="user@kentik.com" 
                        />
                    </Box>

                    <Box paddingBlock="space.100">
                        <Box marginBlockEnd="space.050">
                            <Heading size="xsmall">API Token</Heading>
                        </Box>
                        <Textfield 
                            name="api_token"
                            type="password" 
                            value={apiToken}
                            onChange={(e) => setApiToken(e.target.value)}
                            placeholder={settings.isTokenSet ? '••••••••••••' : 'Enter your Kentik API Token'} 
                        />
                    </Box>

                    {/* --- FIXED TOGGLE SECTION WITH VISIBLE LABELS --- */}
                    <Box paddingBlock="space.200">
                        <Box marginBlockEnd="space.150">
                            <Heading size="small">Real-Time Sync Subscriptions</Heading>
                        </Box>
                        
                        {/* Sync Acknowledge */}
                        <Box paddingBlock="space.100">
                            <Box marginBlockEnd="space.025">
                                <Heading size="xsmall">Sync Acknowledge / Un-Acknowledge Actions</Heading>
                            </Box>
                            <Toggle 
                                id="sync_ack"
                                isChecked={syncAck} 
                                onChange={() => setSyncAck(!syncAck)} 
                            />
                        </Box>

                        {/* Sync Comments */}
                        <Box paddingBlock="space.100">
                            <Box marginBlockEnd="space.025">
                                <Heading size="xsmall">Mirror Agent Comments to Alert Timeline</Heading>
                            </Box>
                            <Toggle 
                                id="sync_comments"
                                isChecked={syncComments} 
                                onChange={() => setSyncComments(!syncComments)} 
                            />
                        </Box>

                        {/* Sync Clear */}
                        <Box paddingBlock="space.100">
                            <Box marginBlockEnd="space.025">
                                <Heading size="xsmall">Auto-Clear Alerts on Issue Resolution</Heading>
                            </Box>
                            <Toggle 
                                id="sync_clear"
                                isChecked={syncClear} 
                                onChange={() => setSyncClear(!syncClear)} 
                            />
                        </Box>
                    </Box>
                </FormSection>
                
                <FormFooter>
                    <Button type="submit" appearance="primary">
                        {saveStatus === 'saving' ? 'Saving...' : 'Save Settings'}
                    </Button>
                </FormFooter>
            </Form>
        </Box>
    );
};

ForgeReconciler.render(<App />);