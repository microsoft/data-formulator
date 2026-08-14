import {
    Box, List, ListItem, ListItemButton, ListItemText, Radio, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { textVar } from '../app/layout';
import { radius } from '../app/tokens';
import type { DataOperation } from '../dataOperations/models';

interface DataOperationCardProps {
    operation: DataOperation;
    selectedPlanId?: string;
    onSelectPlan?: (planId: string) => void;
    compact?: boolean;
}

export const DataOperationCard: React.FC<DataOperationCardProps> = ({
    operation,
    selectedPlanId,
    onSelectPlan,
    compact = false,
}) => {
    const { t } = useTranslation();
    return (
        <Box sx={{
            mt: compact ? 0 : 1,
            width: '100%',
        }}>
            {/* The response is already recorded by the turn/message that carries
                this card, so the card only offers the choices. */}
            <List dense disablePadding sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {operation.plans.map((plan) => {
                    const content = (
                        <>
                            {onSelectPlan && (
                                <Radio
                                    checked={selectedPlanId === plan.id}
                                    tabIndex={-1}
                                    disableRipple
                                    size="small"
                                    sx={{ p: 0.5, mr: 0.5, '& .MuiSvgIcon-root': { fontSize: 16 } }}
                                />
                            )}
                            <ListItemText
                                primary={plan.label}
                                sx={{ my: 0 }}
                                slotProps={{
                                    primary: { sx: { fontSize: textVar.sm, fontWeight: 500, lineHeight: 1.35 } },
                                    secondary: { component: 'div' },
                                }}
                                secondary={(
                                    <Typography component="span" color="text.disabled" sx={{ display: 'block', mt: 0.25, fontSize: textVar.xxs, lineHeight: 1.35 }}>
                                        {plan.steps.map(step => step.displayName).join(', ')}
                                    </Typography>
                                )}
                            />
                        </>
                    );
                    // Options flow and wrap; each stays readable rather than
                    // stretching across a wide panel.
                    const itemSx = {
                        px: 0.5, py: 0.5,
                        alignItems: 'flex-start',
                        width: 'auto',
                        flex: '1 1 260px',
                        maxWidth: 520,
                        borderRadius: radius.sm,
                        border: '1px solid',
                        borderColor: selectedPlanId === plan.id ? 'primary.main' : 'divider',
                    } as const;
                    return onSelectPlan ? (
                        <ListItemButton
                            key={plan.id}
                            selected={selectedPlanId === plan.id}
                            onClick={() => onSelectPlan(plan.id)}
                            sx={itemSx}
                        >
                            {content}
                        </ListItemButton>
                    ) : (
                        <ListItem key={plan.id} sx={itemSx}>
                            {content}
                        </ListItem>
                    );
                })}
            </List>
            {operation.failedSteps.length > 0 && (
                <Box sx={{ py: 1 }}>
                    <Typography variant="body2" color="error">
                        {t('dataLoading.operation.failedSteps', { count: operation.failedSteps.length })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {operation.failedSteps.map(step => step.displayName).join(', ')}
                    </Typography>
                </Box>
            )}
        </Box>
    );
};