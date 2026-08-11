import {
    Box, List, ListItem, ListItemButton, ListItemText, Radio, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { textVar } from '../app/layout';
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
            maxWidth: 520,
        }}>
            {/* The response is already recorded by the turn/message that carries
                this card, so the card only offers the choices. */}
            <Box sx={{ py: 0.25 }}>
                <Typography sx={{ fontSize: textVar.sm, fontWeight: 600, lineHeight: 1.35 }}>
                    {t('dataLoading.operation.title')}
                </Typography>
            </Box>
            <List dense disablePadding>
                {operation.plans.map((plan, index) => {
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
                    return onSelectPlan ? (
                        <ListItemButton
                            key={plan.id}
                            selected={selectedPlanId === plan.id}
                            divider={index < operation.plans.length - 1}
                            onClick={() => onSelectPlan(plan.id)}
                            sx={{ px: 0.5, py: 0.5, alignItems: 'flex-start' }}
                        >
                            {content}
                        </ListItemButton>
                    ) : (
                        <ListItem key={plan.id} divider={index < operation.plans.length - 1} sx={{ px: 0.5, py: 0.5, alignItems: 'flex-start' }}>
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