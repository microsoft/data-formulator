// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState } from 'react';
import { Button, Menu, MenuItem, Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import PublicIcon from '@mui/icons-material/Public';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

export const LanguageSwitcher: React.FC = () => {
    const { i18n, t } = useTranslation();
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng);
        handleClose();
    };

    const getCurrentLanguageLabel = () => {
        return i18n.language === 'ru' ? 'RU' : 'EN';
    };

    return (
        <>
            <Button
                variant="text"
                onClick={handleClick}
                endIcon={<KeyboardArrowDownIcon />}
                startIcon={<PublicIcon />}
                sx={{ textTransform: 'none' }}
                aria-controls={open ? 'language-menu' : undefined}
                aria-haspopup="true"
                aria-expanded={open ? 'true' : undefined}
            >
                {getCurrentLanguageLabel()}
            </Button>
            <Menu
                id="language-menu"
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
                slotProps={{
                    paper: { sx: { py: '4px', px: '8px' } }
                }}
                sx={{
                    '& .MuiMenuItem-root': {
                        padding: '8px 16px',
                        margin: 0,
                        minWidth: 120
                    }
                }}
            >
                <MenuItem
                    onClick={() => changeLanguage('ru')}
                    selected={i18n.language === 'ru'}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        🇷🇺 Русский
                    </Box>
                </MenuItem>
                <MenuItem
                    onClick={() => changeLanguage('en')}
                    selected={i18n.language === 'en'}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        🇬🇧 English
                    </Box>
                </MenuItem>
            </Menu>
        </>
    );
};
