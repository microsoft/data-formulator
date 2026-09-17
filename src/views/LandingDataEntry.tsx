import React, { useState } from 'react';
import { Alert, Box, Button, Chip, Typography, alpha } from '@mui/material';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AddIcon from '@mui/icons-material/Add';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import { useTranslation } from 'react-i18next';
import { AgentChatInput } from './AgentChatInput';
import { buildDataLoadingQuickActions, buildDataLoadingSuggestions } from './dataLoadingSuggestions';
import { ConnectorInstance } from '../components/ComponentType';
import { apiRequest } from '../app/apiClient';
import { getUrls } from '../app/utils';
import { iconVar, textVar } from '../app/layout';

interface LandingDataEntryProps {
    onStartChat: (prompt: string, images: string[], attachments: string[]) => void;
    ensureActiveWorkspace: () => void;
    onUpload: () => void;
    onConnect: () => void;
    onLinkFolder?: () => void;
    onSelectConnector: (connector: ConnectorInstance) => void;
    connectors: ConnectorInstance[];
    readOnly?: boolean;
}

export const LandingDataEntry: React.FC<LandingDataEntryProps> = ({
    onStartChat, ensureActiveWorkspace, onUpload, onConnect, onLinkFolder, onSelectConnector, connectors, readOnly = false,
}) => {
    const { t } = useTranslation();
    const [input, setInput] = useState('');
    const [images, setImages] = useState<string[]>([]);
    const [attachments, setAttachments] = useState<string[]>([]);
    const [uploadCount, setUploadCount] = useState(0);
    const [error, setError] = useState('');
    const disabled = readOnly || uploadCount > 0;
    const submit = (text: string, imageValues: string[], attachmentValues: string[]) => {
        if (disabled || (!text.trim() && !imageValues.length && !attachmentValues.length)) return;
        onStartChat(text.trim(), imageValues, attachmentValues);
        setInput('');
        setImages([]);
        setAttachments([]);
    };
    const suggestionArgs = {
        t, setInput, setImages, setAttachments, ensureActiveWorkspace,
        requestAutoSend: (payload: { text: string; images: string[]; attachments: string[] }) =>
            submit(payload.text, payload.images, payload.attachments),
    };
    const linkStyle = {
        display: 'inline-flex', alignItems: 'center', gap: 0.5, p: 0, border: 'none', borderRadius: 0,
        background: 'none', maxWidth: '100%', minWidth: 0, minHeight: 0, textTransform: 'none', whiteSpace: 'normal',
        fontWeight: 400, fontSize: '0.8125rem', lineHeight: 1.4, textAlign: 'left', overflowWrap: 'anywhere',
        color: theme => alpha(theme.palette.text.primary, 0.76), transition: 'color 120ms ease',
        '& .MuiButton-startIcon': { m: 0, flexShrink: 0, '& .MuiSvgIcon-root': { fontSize: iconVar.md } },
        '&:hover': { background: 'none', color: 'primary.main', textDecoration: 'underline', textUnderlineOffset: 2 },
    } as const;
    const labelStyle = { fontSize: '0.8rem', fontWeight: 600,
        color: theme => alpha(theme.palette.text.primary, 0.72), mr: 0.25, flexShrink: 0 } as const;
    return <Box sx={{ width: '100%', maxWidth: 800, mx: 'auto', textAlign: 'left' }}>
        <Box sx={{ mb: 1.75, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>
            {buildDataLoadingQuickActions(suggestionArgs).map(action => <Chip key={action.kind}
                icon={<BoltOutlinedIcon />} label={action.label} onClick={action.onClick} disabled={disabled}
                variant="outlined" size="small" sx={{ fontSize: textVar.md, minHeight: 30, height: { xs: 'auto', sm: 30 }, maxWidth: '100%', borderRadius: 2,
                    color: 'text.secondary', borderColor: theme => alpha(theme.palette.text.primary, 0.12),
                    '& .MuiChip-label': { whiteSpace: 'normal' },
                    '& .MuiChip-icon': { fontSize: textVar.lg, ml: 0.5, color: 'text.disabled' },
                    '&:hover': { bgcolor: 'action.hover', borderColor: theme => alpha(theme.palette.text.primary, 0.2) } }} />)}
        </Box>
        {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1 }}>{error}</Alert>}
        <AgentChatInput value={input} onChange={setInput} images={images} onImagesChange={setImages}
            onSend={() => submit(input, images, attachments)} disabled={disabled} layout="stacked" minRows={4}
            attachments={attachments} onAttachmentsChange={setAttachments}
            onNonImageFile={async file => {
                if (readOnly) return;
                ensureActiveWorkspace();
                setUploadCount(count => count + 1);
                setError('');
                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    const { data } = await apiRequest(getUrls().SCRATCH_UPLOAD_URL, { method: 'POST', body: formData });
                    const name = (data?.path || `scratch/${file.name}`).replace(/^scratch\//, '');
                    setAttachments(previous => [...previous, name]);
                } catch (reason) { setError(String(reason)); }
                finally { setUploadCount(count => count - 1); }
            }}
            tabSuggestion={t('upload.agentChatTabSuggestion', { defaultValue: 'What dataset do we have here?' })}
            focusSuggestionsLabel={t('upload.agentChatSuggestionsLabel', { defaultValue: 'Try asking' })}
            focusSuggestions={buildDataLoadingSuggestions(suggestionArgs)}
            placeholder={t('upload.agentChatPlaceholder', { defaultValue: 'Ask the agent to find datasets, or extract data from an image or text...' })}
            sendTooltip={t('upload.agentChatSendTooltip', { defaultValue: 'Start chatting with the agent' })}
            sx={{ borderColor: theme => alpha(theme.palette.primary.main, 0.38),
                boxShadow: '0 5px 18px rgba(32, 33, 36, 0.11), 0 1px 4px rgba(32, 33, 36, 0.07)',
                '&:hover': { boxShadow: '0 6px 20px rgba(32, 33, 36, 0.11), 0 2px 6px rgba(32, 33, 36, 0.06)' } }} />
        <Box sx={{ mt: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.75 }}>
                <Typography variant="body2" sx={labelStyle}>
                    {t('upload.dataSourcesLabel', { defaultValue: 'Connected to:' })}
                </Typography>
                {connectors.map(connector => <Button disableRipple key={connector.id} onClick={() => onSelectConnector(connector)}
                    title={connector.connection_identity || connector.display_name} sx={linkStyle}
                    startIcon={<Box sx={{ width: 7, height: 7, borderRadius: '50%',
                        bgcolor: connector.connected || connector.sso_auto_connect ? 'success.main' : 'error.main' }} />}>
                    {connector.display_name}
                </Button>)}
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.75 }}>
                <Typography variant="body2" sx={labelStyle}>
                    {t('upload.addSourceLabel', { defaultValue: 'Add data:' })}
                </Typography>
                <Button disableRipple startIcon={<UploadFileIcon />} onClick={onUpload} sx={linkStyle}>
                    {t('upload.uploadData', { defaultValue: 'Upload data' })}
                </Button>
                {onLinkFolder && <Button disableRipple startIcon={<CreateNewFolderIcon />} onClick={onLinkFolder} sx={linkStyle}>
                    {t('upload.localFolder', { defaultValue: 'Link local folder' })}
                </Button>}
                <Button disableRipple startIcon={<AddIcon />} onClick={onConnect} sx={linkStyle}>
                    {t('upload.addConnection', { defaultValue: 'Connect databases' })}
                </Button>
            </Box>
        </Box>
    </Box>;
};