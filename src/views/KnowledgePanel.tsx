// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * KnowledgePanel — panel for browsing and editing knowledge items.
 *
 * Shows two collapsible sections: Rules (flat) and Workflows (flat).
 * Items are tagged for organization; no subdirectory grouping.
 * Supports search, edit, and delete. Rules can be created directly by
 * the user via the "+" affordance; workflows are produced by the
 * agent's distillation flow (see SessionDistill).
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import {
    Box,
    Typography,
    IconButton,
    Tooltip,
    TextField,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    CircularProgress,
    Divider,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import Editor from 'react-simple-code-editor';

import { useKnowledgeStore } from '../app/useKnowledgeStore';
import { deleteKnowledge, type KnowledgeCategory } from '../api/knowledgeApi';
import type { KnowledgeItem } from '../api/knowledgeApi';
import { borderColor, radius } from '../app/tokens';
import { dfActions, type DataFormulatorState } from '../app/dfSlice';
import { isLeafDerivedTable, buildLeafEvents } from './workflowContext';
import { SessionDistillDialog, findSessionWorkflow } from './SessionDistill';

// Default file name and seed body for a brand-new rule. Rules are plain
// Markdown — the user just edits the body; no front matter is required.
const DEFAULT_RULE_FILENAME = 'agent.md';
const RULE_TEMPLATE = `# Agent rules

Describe the constraints or conventions the agent should follow.
`;

// ── Persistent action row (always visible at the top of each section) ────

interface ActionRowProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
}

const ActionRow: React.FC<ActionRowProps> = ({ icon, label, onClick }) => (
    <Box
        onClick={onClick}
        role="button"
        tabIndex={0}
        sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            mx: 1.5, my: 0.5,
            px: 1, py: 0.5,
            cursor: 'pointer',
            color: 'primary.main',
            border: theme => `1px solid ${alpha(theme.palette.primary.main, 0.5)}`,
            borderRadius: 1,
            bgcolor: 'transparent',
            transition: 'background-color 120ms ease, border-color 120ms ease',
            '&:hover': {
                bgcolor: theme => alpha(theme.palette.primary.main, 0.04),
                borderColor: 'primary.main',
            },
            '&:focus-visible': {
                outline: theme => `2px solid ${theme.palette.primary.main}`,
                outlineOffset: 1,
            },
            userSelect: 'none',
        }}
    >
        <Box sx={{ color: 'inherit', display: 'flex' }}>{icon}</Box>
        <Typography sx={{
            fontSize: 12, fontWeight: 500, color: 'inherit', wordBreak: 'break-word',
        }}>
            {label}
        </Typography>
    </Box>
);

// ── Main Component ───────────────────────────────────────────────────────

export const KnowledgePanel: React.FC = () => {
    const { t } = useTranslation();
    const store = useKnowledgeStore();
    const dispatch = useDispatch();

    // For the "distill from this session" placeholder under WORKFLOWS.
    const tables = useSelector((s: DataFormulatorState) => s.tables);
    // Workflow replay needs data to run on — disable replay when the
    // workspace has no tables loaded.
    const hasTables = tables.length > 0;
    const charts = useSelector((s: DataFormulatorState) => s.charts);
    const conceptShelfItems = useSelector((s: DataFormulatorState) => s.conceptShelfItems);
    const selectedModelId = useSelector((s: DataFormulatorState) => s.selectedModelId);
    const allModels = useSelector((s: DataFormulatorState) => [...s.globalModels, ...s.models]);

    const [searchQuery, setSearchQuery] = useState('');

    // Editor dialog state — used both for editing existing entries and
    // for creating new rules (in which case editorOriginalPath is empty).
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorCategory, setEditorCategory] = useState<KnowledgeCategory>('rules');
    const [editorPath, setEditorPath] = useState('');
    const [editorContent, setEditorContent] = useState('');
    const [editorOriginalPath, setEditorOriginalPath] = useState('');
    const [editorSaving, setEditorSaving] = useState(false);
    const [editorLoading, setEditorLoading] = useState(false);

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState<{ category: KnowledgeCategory; path: string; title: string } | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Fetch all on mount
    useEffect(() => {
        store.fetchAll();
    }, []);

    // ── Search ───────────────────────────────────────────────────────────

    const handleSearch = useCallback(() => {
        const q = searchQuery.trim();
        if (q) {
            store.search(q);
        } else {
            store.clearSearch();
        }
    }, [searchQuery, store]);

    const clearSearch = useCallback(() => {
        setSearchQuery('');
        store.clearSearch();
    }, [store]);

    // ── Editor ──────────────────────────────────────────────────────────

    const openCreateDialog = useCallback((category: KnowledgeCategory) => {
        setEditorCategory(category);
        setEditorPath(category === 'rules' ? DEFAULT_RULE_FILENAME : '');
        setEditorOriginalPath('');
        setEditorContent(category === 'rules' ? RULE_TEMPLATE : '');
        setEditorLoading(false);
        setEditorOpen(true);
    }, []);

    const openEditDialog = useCallback(async (category: KnowledgeCategory, item: KnowledgeItem) => {
        setEditorCategory(category);
        setEditorPath(item.path);
        setEditorOriginalPath(item.path);
        setEditorContent('');
        setEditorOpen(true);
        setEditorLoading(true);

        const content = await store.read(category, item.path);
        if (content !== null) {
            setEditorContent(content);
        }
        setEditorLoading(false);
    }, [store]);

    const handleSave = useCallback(async () => {
        if (!editorPath.trim() || !editorContent.trim()) return;
        setEditorSaving(true);

        const fileName = editorPath.endsWith('.md') ? editorPath : `${editorPath}.md`;
        const path = fileName;
        const success = await store.save(editorCategory, path, editorContent);
        if (success && editorOriginalPath && path !== editorOriginalPath) {
            try { await deleteKnowledge(editorCategory, editorOriginalPath); } catch { /* best-effort */ }
        }
        setEditorSaving(false);
        if (success) {
            setEditorOpen(false);
        }
    }, [editorPath, editorOriginalPath, editorContent, editorCategory, store]);

    const handleDelete = useCallback(async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        await store.remove(deleteTarget.category, deleteTarget.path);
        setDeleting(false);
        setDeleteTarget(null);
    }, [deleteTarget, store]);

    // ── Distill from current session ────────────────────────────────────
    // The WORKFLOWS placeholder is bound to the
    // active workspace. When the workspace already has a distilled
    // workflow (matched by `sourceWorkspaceId` in front matter) we
    // expose an inline ⟳ Update affordance on the existing entry;
    // otherwise the placeholder opens the dialog in *create* mode.
    // See design-docs/24-session-scoped-distillation.md.

    const activeWorkspace = useSelector((s: DataFormulatorState) => s.activeWorkspace);
    const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
    const [sessionUpdateMode, setSessionUpdateMode] = useState(false);
    // True while the SessionDistillDialog is running its LLM call.
    // The dialog can be closed independently; this flag lives on the panel
    // so the action row keeps a busy indicator until the request finishes.
    const [sessionDistilling, setSessionDistilling] = useState(false);

    // True when at least one leaf in the session has a distillable chain
    // (i.e. has a user message). Cheap to compute — same predicate as
    // before, just used for the placeholder enable-state.
    const hasDistillableSession = React.useMemo(() => {
        return tables.some(t =>
            isLeafDerivedTable(t, tables) &&
            buildLeafEvents(t, tables, charts, conceptShelfItems) != null,
        );
    }, [tables, charts, conceptShelfItems]);

    const selectedModel = allModels.find(m => m.id === selectedModelId);
    const canDistillFromSession = hasDistillableSession && !!selectedModel && !!activeWorkspace;

    const sessionWorkflow = React.useMemo(
        () => findSessionWorkflow(
            store.stateMap['workflows'].items,
            activeWorkspace?.id,
        ),
        [store.stateMap, activeWorkspace?.id],
    );

    const openSessionDistillDialog = useCallback((updateMode: boolean) => {
        setSessionUpdateMode(updateMode);
        setSessionDialogOpen(true);
    }, []);

    // ── Replay a workflow ────────────────────────────────────────────
    // Reads the workflow body and asks the data agent (in SimpleChartRecBox)
    // to reproduce the captured workflow on the currently loaded data. v1 is
    // deliberately simple: we hand the whole workflow to the agent in one
    // request via a window event and let it figure out the rest.
    // See discussion/replayable-experience-workflow.md.
    const handleReplay = useCallback(async (item: KnowledgeItem) => {
        const content = await store.read('workflows', item.path);
        if (content == null) return;
        const prompt = t('knowledge.replayPrompt', { content });
        window.dispatchEvent(new CustomEvent('df-replay-workflow', {
            detail: { prompt, title: item.title },
        }));
    }, [store, t]);

    // ── Render section ──────────────────────────────────────────────────


    const renderItem = useCallback((
        category: KnowledgeCategory,
        item: KnowledgeItem,
    ) => {
        const displayTitle = (item.title || '').replace(/^\s*(?:Workflow|Experience) from .+?:\s*/i, '').trim();
        const primary = displayTitle || item.title || item.path;
        return (
            <Box
                key={`${category}/${item.path}`}
                onClick={() => openEditDialog(category, item)}
                sx={{
                    display: 'flex', alignItems: 'flex-start', gap: 0.75,
                    px: 1.5, py: 0.625,
                    cursor: 'pointer',
                    color: 'text.primary',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:hover .item-actions': { display: 'inline-flex' },
                    userSelect: 'none',
                }}
            >
                <DescriptionOutlinedIcon sx={{ fontSize: 16, color: 'text.primary', mt: 0.25 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 500, lineHeight: 1.45, wordBreak: 'break-word', color: 'text.primary' }}>
                        {primary}
                    </Typography>
                </Box>
                {item.source === 'agent_summarized' && (
                    <Tooltip title={t('knowledge.sourceAgent')}>
                        <SmartToyOutlinedIcon sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }} />
                    </Tooltip>
                )}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'stretch', flexShrink: 0 }}>
                    {category === 'workflows' && (
                        <Tooltip title={hasTables ? t('knowledge.replayTooltip') : t('knowledge.replayNoData')}>
                            <span>
                                <IconButton
                                    size="small"
                                    disabled={!hasTables}
                                    onClick={(e) => { e.stopPropagation(); handleReplay(item); }}
                                    sx={{
                                        p: 0.25,
                                        color: 'primary.main',
                                        '&:hover': { bgcolor: theme => alpha(theme.palette.primary.main, 0.08) },
                                    }}
                                >
                                    <PlayArrowIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                            </span>
                        </Tooltip>
                    )}
                    <IconButton
                        className="item-actions"
                        size="small"
                        aria-label={t('knowledge.deleteItem')}
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ category, path: item.path, title: item.title }); }}
                        sx={{ p: 0.25, mt: 'auto', display: 'none', color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                    >
                        <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                </Box>
            </Box>
        );
    }, [openEditDialog, t, handleReplay, hasTables]);

    const renderCategorySection = useCallback((
        category: KnowledgeCategory,
        label: string,
        hint: string,
    ) => {
        const state = store.stateMap[category];

        // Persistent action row at the top of the section. Rules: opens
        // the create dialog. Workflows: opens the session distill
        // dialog in create or update mode depending on whether the active
        // workspace already has a distilled workflow.
        // See design-docs/24-session-scoped-distillation.md.
        const renderActionRow = () => {
            if (category === 'rules') {
                return (
                    <ActionRow
                        icon={<AddIcon sx={{ fontSize: 18 }} />}
                        label={t('knowledge.addNewRule', { defaultValue: 'Add new rule' })}
                        onClick={() => openCreateDialog('rules')}
                    />
                );
            }
            // workflows
            if (!canDistillFromSession) {
                // No active workspace, no model, or no distillable thread
                // yet — show a passive hint instead of a dead action.
                if (state.items.length > 0) return null;
                return (
                    <Typography sx={{ fontSize: 11, color: 'text.disabled', px: 1.5, py: 0.75, fontStyle: 'italic' }}>
                        {t('knowledge.noItems')}
                    </Typography>
                );
            }
            const updateMode = !!sessionWorkflow;
            if (sessionDistilling) {
                return (
                    <ActionRow
                        icon={<CircularProgress size={14} />}
                        label={t('knowledge.distilling', { defaultValue: 'Distilling workflow…' })}
                        onClick={() => openSessionDistillDialog(updateMode)}
                    />
                );
            }
            return (
                <ActionRow
                    icon={updateMode
                        ? <RefreshIcon sx={{ fontSize: 18 }} />
                        : <AddIcon sx={{ fontSize: 18 }} />}
                    label={updateMode
                        ? t('knowledge.updateFromSession', { defaultValue: 'Update from this session' })
                        : t('knowledge.distillFromSession', { defaultValue: 'Distill from this session' })}
                    onClick={() => openSessionDistillDialog(updateMode)}
                />
            );
        };

        return (
            <Box key={category} sx={{ pb: 1 }}>
                <Box
                    sx={{
                        display: 'flex', alignItems: 'center',
                        px: 1.5, pt: 2, pb: 0.75,
                    }}
                >
                    <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', letterSpacing: 0.6, textTransform: 'uppercase' }}>
                        {label}
                    </Typography>
                </Box>

                {/* Always-visible guidance for the section, set off by a
                    subtle left accent line below the title. */}
                <Box
                    sx={{
                        mx: 1.5, mb: 0.75,
                        pl: 1, py: 0.25,
                        borderLeft: '2px solid',
                        borderColor: theme => alpha(theme.palette.primary.main, 0.25),
                    }}
                >
                    <Typography sx={{ fontSize: 11, color: 'text.disabled', lineHeight: 1.55 }}>
                        {hint}
                    </Typography>
                </Box>

                {state.loading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
                        <CircularProgress size={16} />
                    </Box>
                )}
                {!state.loading && renderActionRow()}
                {state.items.map(item => renderItem(category, item))}
            </Box>
        );
    }, [store.stateMap, renderItem, openCreateDialog, t, canDistillFromSession, sessionWorkflow, sessionDistilling, openSessionDistillDialog]);

    // ── Main render ─────────────────────────────────────────────────────

    return (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Content area. Rules vs Workflows guidance is surfaced via an
                info icon next to each section title (see renderCategorySection). */}
            <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }}>
                <Box>
                    {renderCategorySection('rules', t('knowledge.rules'), t('knowledge.rulesHint'))}
                    {renderCategorySection('workflows', t('knowledge.workflows'), t('knowledge.workflowsHint'))}
                </Box>
            </Box>

            {/* Session distill dialog */}
            <SessionDistillDialog
                open={sessionDialogOpen}
                updateMode={sessionUpdateMode}
                onClose={() => setSessionDialogOpen(false)}
                onRunningChange={setSessionDistilling}
            />

            {/* Editor dialog */}
            <Dialog
                open={editorOpen}
                onClose={() => { if (!editorSaving) setEditorOpen(false); }}
                maxWidth="md"
                fullWidth
                sx={{ '& .MuiDialog-paper': { maxHeight: '90vh' } }}
            >
                <DialogTitle sx={{ fontSize: 15, pb: 0.5 }}>
                    {t('knowledge.editTitle')}
                </DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '8px !important' }}>
                    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                        <TextField
                            size="small"
                            label={t('knowledge.fileName')}
                            placeholder={t('knowledge.fileNamePlaceholder')}
                            value={editorPath}
                            onChange={(e) => setEditorPath(e.target.value)}
                            sx={{ flex: 1, minWidth: 150, '& .MuiInputBase-input': { fontSize: 12 } }}
                            slotProps={{ inputLabel: { sx: { fontSize: 12 } } }}
                        />
                    </Box>

                    {editorLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress size={24} />
                        </Box>
                    ) : (
                        <>
                            <Box sx={{
                                border: `1px solid ${borderColor.component}`,
                                borderRadius: radius.sm,
                                overflow: 'auto',
                                maxHeight: '60vh',
                                minHeight: 200,
                            }}>
                                <Editor
                                    value={editorContent}
                                    onValueChange={setEditorContent}
                                    highlight={(code) => code}
                                    padding={16}
                                    placeholder="# Title\n\nWrite your knowledge content in Markdown..."
                                    style={{
                                        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                                        fontSize: 12,
                                        lineHeight: 1.5,
                                        minHeight: 200,
                                        whiteSpace: 'pre-wrap',
                                        outline: 'none',
                                    }}
                                />
                            </Box>
                        </>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => { setEditorOpen(false); setDeleteTarget({ category: editorCategory, path: editorOriginalPath, title: editorOriginalPath }); }}
                        color="error"
                        sx={{ textTransform: 'none', fontSize: 12, mr: 'auto' }}
                    >
                        {t('app.delete')}
                    </Button>
                    <Button
                        onClick={() => setEditorOpen(false)}
                        disabled={editorSaving}
                        sx={{ textTransform: 'none', fontSize: 12 }}
                    >
                        {t('app.cancel')}
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={
                            editorSaving
                            || !editorContent.trim()
                            || !editorPath.trim()
                        }
                        variant="contained"
                        sx={{ textTransform: 'none', fontSize: 12 }}
                    >
                        {editorSaving ? t('knowledge.saving') : t('knowledge.save')}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete confirmation */}
            <Dialog open={!!deleteTarget} onClose={() => { if (!deleting) setDeleteTarget(null); }}>
                <DialogTitle sx={{ fontSize: 15, pb: 0.5 }}>
                    {deleteTarget ? t('knowledge.deleteConfirm', { title: deleteTarget.title }) : ''}
                </DialogTitle>
                <DialogContent>
                    <Typography sx={{ fontSize: 13 }}>
                        {t('knowledge.deleteConfirmBody')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteTarget(null)} disabled={deleting} sx={{ textTransform: 'none', fontSize: 12 }}>
                        {t('app.cancel')}
                    </Button>
                    <Button onClick={handleDelete} disabled={deleting} color="error" variant="contained" sx={{ textTransform: 'none', fontSize: 12 }}>
                        {deleting ? <CircularProgress size={14} /> : t('app.delete')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
