// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * AgentRulesDialog — knowledge-backed rules editor.
 *
 * Previously stored rules as plain text in Redux state. Now reads/writes
 * rules as individual Markdown files via the Knowledge API.
 *
 * Each rule is a `.md` file under `knowledge/rules/`.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import {
    Button,
    Typography,
    Box,
    DialogTitle,
    Dialog,
    DialogContent,
    DialogActions,
    IconButton,
    useTheme,
    Badge,
    alpha,
    CircularProgress,
    List,
    ListItemButton,
    ListItemText,
    ListItemSecondaryAction,
    TextField,
    Tooltip,
} from '@mui/material';
import RuleIcon from '@mui/icons-material/Rule';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import { dfActions } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { radius, borderColor } from '../app/tokens';
import { dialogHeight, iconVar, textVar } from '../app/layout';
import {
    listKnowledge,
    readKnowledge,
    writeKnowledge,
    deleteKnowledge,
    type KnowledgeItem,
} from '../api/knowledgeApi';

export const AgentRulesDialog: React.FC<{
    externalOpen?: boolean;
    onExternalClose?: () => void;
}> = ({ externalOpen, onExternalClose }) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const dispatch = useDispatch<AppDispatch>();
    const [internalOpen, setInternalOpen] = useState(false);
    const open = externalOpen !== undefined ? externalOpen : internalOpen;

    // Rules list
    const [rules, setRules] = useState<KnowledgeItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [ruleCount, setRuleCount] = useState(0);

    // Editor state
    const [selectedRule, setSelectedRule] = useState<KnowledgeItem | null>(null);
    const [editorContent, setEditorContent] = useState('');
    const [editorDirty, setEditorDirty] = useState(false);
    const [originalContent, setOriginalContent] = useState('');
    const [editorLoading, setEditorLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Create new rule
    const [creating, setCreating] = useState(false);
    const [newFileName, setNewFileName] = useState('');

    const fetchRules = useCallback(async () => {
        setLoading(true);
        try {
            const items = await listKnowledge('rules');
            setRules(items);
            setRuleCount(items.length);
        } catch {
            // best-effort
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open) {
            fetchRules();
            setSelectedRule(null);
            setEditorContent('');
            setEditorDirty(false);
            setCreating(false);
        }
    }, [open, fetchRules]);

    const handleSelectRule = useCallback(async (item: KnowledgeItem) => {
        setSelectedRule(item);
        setCreating(false);
        setEditorLoading(true);
        try {
            const content = await readKnowledge('rules', item.path);
            setEditorContent(content);
            setOriginalContent(content);
            setEditorDirty(false);
        } catch {
            setEditorContent('');
            setOriginalContent('');
        } finally {
            setEditorLoading(false);
        }
    }, []);

    const handleSave = useCallback(async () => {
        if (!selectedRule && !creating) return;
        setSaving(true);
        try {
            const path = creating
                ? (newFileName.endsWith('.md') ? newFileName : `${newFileName}.md`)
                : selectedRule!.path;
            await writeKnowledge('rules', path, editorContent);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: 'agent-rules',
                value: t('knowledge.saved'),
            }));
            setEditorDirty(false);
            setOriginalContent(editorContent);
            if (creating) {
                setCreating(false);
                setNewFileName('');
            }
            await fetchRules();
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'agent-rules',
                value: t('knowledge.failedToSave'),
            }));
        } finally {
            setSaving(false);
        }
    }, [selectedRule, creating, newFileName, editorContent, fetchRules, dispatch, t]);

    const handleDeleteRule = useCallback(async (item: KnowledgeItem, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await deleteKnowledge('rules', item.path);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: 'agent-rules',
                value: t('knowledge.deleted'),
            }));
            if (selectedRule?.path === item.path) {
                setSelectedRule(null);
                setEditorContent('');
                setEditorDirty(false);
            }
            await fetchRules();
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'agent-rules',
                value: t('knowledge.failedToDelete'),
            }));
        }
    }, [selectedRule, fetchRules, dispatch, t]);

    const handleStartCreate = useCallback(() => {
        setCreating(true);
        setSelectedRule(null);
        setNewFileName('');
        setEditorContent('');
        setOriginalContent('');
        setEditorDirty(false);
    }, []);

    const handleClose = () => {
        if (onExternalClose) {
            onExternalClose();
        } else {
            setInternalOpen(false);
        }
    };

    const codingPlaceholder = `# Rule Title

Write your rule content here in Markdown.

## Examples
- ROI should be computed as (revenue - cost) / cost.
- Date format should be YYYY-MM-DD.
`;

    return (
        <>
            {externalOpen === undefined && (
                <Badge
                    color="primary"
                    variant="standard"
                    invisible={ruleCount === 0}
                    badgeContent={ruleCount}
                    sx={{
                        '& .MuiBadge-badge': {
                            minWidth: 0,
                            height: 12,
                            fontSize: 8,
                            top: 12,
                            right: 8,
                            px: 0.5,
                            color: theme.palette.primary.textColor || theme.palette.primary.main,
                            background: alpha(theme.palette.primary.light, 0.2),
                        },
                    }}
                >
                    <Button
                        variant="text"
                        sx={{ textTransform: 'none' }}
                        onClick={() => setInternalOpen(true)}
                        startIcon={<RuleIcon />}
                    >
                        {t('agentRules.title')}
                    </Button>
                </Badge>
            )}
            <Dialog
                onClose={handleClose}
                open={open}
                sx={{ '& .MuiDialog-paper': { maxWidth: 1100, height: '90vh', maxHeight: dialogHeight(900), width: '94%' } }}
                maxWidth={false}
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6">{t('agentRules.title')}</Typography>
                    <IconButton
                        aria-label={t('app.close')}
                        onClick={handleClose}
                        sx={{ color: (theme) => theme.palette.grey[500] }}
                    >
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent sx={{ display: 'flex', gap: 2, minHeight: dialogHeight(400) }}>
                    {/* Rules list */}
                    <Box sx={{
                        width: 200, minWidth: 200,
                        borderRight: `1px solid ${borderColor.divider}`,
                        backgroundColor: 'rgba(0, 0, 0, 0.018)',
                        borderRadius: 1,
                        px: 1,
                        py: 0.75,
                    }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                            <Typography sx={{ fontSize: textVar.sm, fontWeight: 600, flex: 1, color: 'text.secondary' }}>
                                {t('knowledge.rules')}
                            </Typography>
                            <Tooltip title={t('knowledge.newItem')}>
                                <IconButton size="small" onClick={handleStartCreate} sx={{ p: 0.25 }}>
                                    <AddIcon sx={{ fontSize: iconVar.md }} />
                                </IconButton>
                            </Tooltip>
                        </Box>
                        {loading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                                <CircularProgress size={20} />
                            </Box>
                        ) : (
                            <List dense disablePadding>
                                {rules.map(rule => (
                                    <ListItemButton
                                        key={rule.path}
                                        selected={selectedRule?.path === rule.path}
                                        onClick={() => handleSelectRule(rule)}
                                        sx={{
                                            borderRadius: 1, py: 0.5, px: 1, mb: 0.25,
                                            '&.Mui-selected': {
                                                bgcolor: 'rgba(25, 118, 210, 0.08)',
                                                boxShadow: 'inset 2px 0 0 rgba(25, 118, 210, 0.8)',
                                            },
                                            '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.045)' },
                                        }}
                                    >
                                        <ListItemText
                                            primary={rule.title}
                                            primaryTypographyProps={{ fontSize: textVar.sm, noWrap: true }}
                                        />
                                        <ListItemSecondaryAction>
                                            <IconButton
                                                edge="end"
                                                size="small"
                                                onClick={(e) => handleDeleteRule(rule, e)}
                                                sx={{ p: 0.25, opacity: 0, '.MuiListItemButton-root:hover &': { opacity: 1 }, '&:hover': { color: 'error.main' } }}
                                            >
                                                <DeleteOutlineIcon sx={{ fontSize: iconVar.sm }} />
                                            </IconButton>
                                        </ListItemSecondaryAction>
                                    </ListItemButton>
                                ))}
                                {rules.length === 0 && !loading && (
                                    <Typography sx={{ fontSize: textVar.xs, color: 'text.disabled', py: 2, textAlign: 'center', fontStyle: 'italic' }}>
                                        {t('knowledge.noItems')}
                                    </Typography>
                                )}
                            </List>
                        )}
                    </Box>

                    {/* Editor */}
                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        {creating && (
                            <TextField
                                size="small"
                                label={t('knowledge.fileName')}
                                placeholder={t('knowledge.fileNamePlaceholder')}
                                value={newFileName}
                                onChange={(e) => setNewFileName(e.target.value)}
                                sx={{ mb: 1, '& .MuiInputBase-input': { fontSize: textVar.sm } }}
                                slotProps={{ inputLabel: { sx: { fontSize: textVar.sm } } }}
                            />
                        )}
                        {selectedRule && (
                            <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary', mb: 0.5, fontWeight: 500 }}>
                                {selectedRule.title}
                                <Typography component="span" sx={{ fontSize: textVar.xxs, color: 'text.disabled', ml: 1 }}>
                                    {selectedRule.path}
                                </Typography>
                            </Typography>
                        )}
                        {editorLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4, flex: 1 }}>
                                <CircularProgress size={24} />
                            </Box>
                        ) : (selectedRule || creating) ? (
                            <Box sx={{
                                border: `1px solid ${editorDirty ? theme.palette.primary.main : borderColor.component}`,
                                borderRadius: radius.sm,
                                overflow: 'auto',
                                flex: 1,
                                minHeight: 0,
                                boxShadow: editorDirty ? `0 2px 8px ${theme.palette.primary.main}40` : undefined,
                                transition: 'box-shadow 0.3s ease-in-out',
                            }}>
                                <MarkdownEditor
                                    value={editorContent}
                                    onChange={(code: string) => {
                                        setEditorContent(code);
                                        setEditorDirty(code !== originalContent);
                                    }}
                                    placeholder={codingPlaceholder}
                                />
                            </Box>
                        ) : (
                            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Typography sx={{ fontSize: textVar.sm, color: 'text.disabled', fontStyle: 'italic' }}>
                                    {t('knowledge.emptyState')}
                                </Typography>
                            </Box>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={handleClose}
                        sx={{ textTransform: 'none' }}
                    >
                        {t('app.close')}
                    </Button>
                    {(selectedRule || creating) && (
                        <Button
                            variant="contained"
                            disabled={saving || !editorDirty || (creating && !newFileName.trim())}
                            onClick={handleSave}
                            sx={{ textTransform: 'none' }}
                        >
                            {saving ? t('knowledge.saving') : t('knowledge.save')}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>
        </>
    );
};
