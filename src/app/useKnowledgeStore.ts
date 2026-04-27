// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Knowledge state management — React hooks for knowledge CRUD & search.
 *
 * Uses plain React state (not Redux) because knowledge data is server-side
 * and only needed by the KnowledgePanel and save-as-experience flows.
 * Errors are dispatched to the global MessageSnackbar via dfActions.addMessages.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { dfActions } from './dfSlice';
import type { AppDispatch } from './store';
import {
    listKnowledge,
    readKnowledge,
    writeKnowledge,
    deleteKnowledge,
    searchKnowledge,
    distillExperience,
    type KnowledgeCategory,
    type KnowledgeItem,
    type KnowledgeSearchResult,
} from '../api/knowledgeApi';

export interface KnowledgeCategoryState {
    items: KnowledgeItem[];
    loading: boolean;
    loaded: boolean;
}

const EMPTY_CATEGORY: KnowledgeCategoryState = { items: [], loading: false, loaded: false };

export function useKnowledgeStore() {
    const dispatch = useDispatch<AppDispatch>();
    const { t } = useTranslation();

    const [rules, setRules] = useState<KnowledgeCategoryState>({ ...EMPTY_CATEGORY });
    const [skills, setSkills] = useState<KnowledgeCategoryState>({ ...EMPTY_CATEGORY });
    const [experiences, setExperiences] = useState<KnowledgeCategoryState>({ ...EMPTY_CATEGORY });

    const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
    const [searching, setSearching] = useState(false);

    const stateMap = { rules, skills, experiences };
    const setterMap = useRef({ rules: setRules, skills: setSkills, experiences: setExperiences });

    const fetchList = useCallback(async (category: KnowledgeCategory) => {
        const setter = setterMap.current[category];
        setter(prev => ({ ...prev, loading: true }));
        try {
            const items = await listKnowledge(category);
            setter({ items, loading: false, loaded: true });
        } catch {
            setter(prev => ({ ...prev, loading: false }));
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'knowledge',
                value: t('knowledge.failedToLoad'),
            }));
        }
    }, [dispatch, t]);

    const fetchAll = useCallback(async () => {
        await Promise.all([
            fetchList('rules'),
            fetchList('skills'),
            fetchList('experiences'),
        ]);
    }, [fetchList]);

    useEffect(() => {
        const handler = (e: Event) => {
            const cat = (e as CustomEvent).detail?.category as KnowledgeCategory | undefined;
            if (cat) fetchList(cat);
            else fetchAll();
        };
        window.addEventListener('knowledge-changed', handler);
        return () => window.removeEventListener('knowledge-changed', handler);
    }, [fetchList, fetchAll]);

    const read = useCallback(async (
        category: KnowledgeCategory,
        path: string,
    ): Promise<string | null> => {
        try {
            return await readKnowledge(category, path);
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'knowledge',
                value: t('knowledge.failedToLoad'),
            }));
            return null;
        }
    }, [dispatch, t]);

    const save = useCallback(async (
        category: KnowledgeCategory,
        path: string,
        content: string,
    ): Promise<boolean> => {
        try {
            await writeKnowledge(category, path, content);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: 'knowledge',
                value: t('knowledge.saved'),
            }));
            await fetchList(category);
            return true;
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'knowledge',
                value: t('knowledge.failedToSave'),
            }));
            return false;
        }
    }, [dispatch, t, fetchList]);

    const remove = useCallback(async (
        category: KnowledgeCategory,
        path: string,
    ): Promise<boolean> => {
        try {
            await deleteKnowledge(category, path);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: 'knowledge',
                value: t('knowledge.deleted'),
            }));
            await fetchList(category);
            return true;
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'knowledge',
                value: t('knowledge.failedToDelete'),
            }));
            return false;
        }
    }, [dispatch, t, fetchList]);

    const search = useCallback(async (
        query: string,
        categories?: KnowledgeCategory[],
    ) => {
        if (!query.trim()) {
            setSearchResults([]);
            return;
        }
        setSearching(true);
        try {
            const results = await searchKnowledge(query, categories);
            setSearchResults(results);
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'knowledge',
                value: t('knowledge.failedToSearch'),
            }));
        } finally {
            setSearching(false);
        }
    }, [dispatch, t]);

    const clearSearch = useCallback(() => {
        setSearchResults([]);
    }, []);

    const distill = useCallback(async (
        sessionId: string,
        userQuestion: string,
        model: Record<string, any>,
        categoryHint?: string,
    ): Promise<boolean> => {
        try {
            await distillExperience(sessionId, userQuestion, model, categoryHint);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: 'knowledge',
                value: t('knowledge.distilled'),
            }));
            await fetchList('experiences');
            return true;
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'knowledge',
                value: t('knowledge.failedToDistill'),
            }));
            return false;
        }
    }, [dispatch, t, fetchList]);

    return {
        rules,
        skills,
        experiences,
        stateMap,
        searchResults,
        searching,
        fetchList,
        fetchAll,
        read,
        save,
        remove,
        search,
        clearSearch,
        distill,
    };
}
