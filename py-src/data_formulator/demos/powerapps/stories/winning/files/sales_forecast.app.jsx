// @df-app {"version": 2, "title": "Sales forecast", "tables": ["forecast_by_month", "forecast_deals"]}
import { useState } from 'react';
import {
  Container,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@df/data';
import {
  AppHeader,
  AppTheme,
  BarList,
  DataTable,
  FilterBar,
  FlintChart,
  Kpi,
  KpiStrip,
  ValueSelect,
  queryFilters,
} from '@df/chart';
import { format } from '@df/format';

// A titled tile. Its parts are spaced by the gap, not by margins.
function Tile({ title, subtitle, children }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Stack spacing={0.25}>
        <Typography variant="subtitle1" fontWeight={600}>{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
        )}
      </Stack>
      {children}
    </Paper>
  );
}

export default function App() {
  const [product, setProduct] = useState('');
  const [quarter, setQuarter] = useState('');
  // Every quarter, in month order, for the key figures (they keep all quarters, so leave out its filter).
  const months = useQuery('forecast_by_month', {
    columns: ['month', 'quarter'],
    filters: queryFilters({ product_line: product }),
    aggregates: [{ op: 'sum', field: 'weighted' }, { op: 'sum', field: 'deals' }],
    orderBy: 'month',
  });
  const byMonth = useQuery('forecast_by_month', {
    columns: ['month', 'region'],
    filters: queryFilters({ product_line: product, quarter }),
    aggregates: [{ op: 'sum', field: 'weighted' }],
    orderBy: 'month',
  });
  const byRegion = useQuery('forecast_by_month', {
    columns: ['region'],
    filters: queryFilters({ product_line: product, quarter }),
    aggregates: [{ op: 'sum', field: 'weighted' }],
    orderBy: [{ field: 'weighted_sum', descending: true }],
  });
  const deals = useQuery('forecast_deals', {
    filters: queryFilters({ product_line: product, quarter }),
    orderBy: [{ field: 'weighted', descending: true }],
    limit: 25,
  });

  // Each quarter's weighted pipeline and deals, in the order its months come.
  const quarters = months.rows.reduce((list, row) => {
    const last = list[list.length - 1];
    if (last && last.quarter === row.quarter) {
      last.weighted += row.weighted_sum;
      last.deals += row.deals_sum;
    } else {
      list.push({ quarter: row.quarter, weighted: row.weighted_sum, deals: row.deals_sum });
    }
    return list;
  }, []);
  const shown = quarter ? quarters.filter(row => row.quarter === quarter) : quarters;
  const forecast = shown.reduce((sum, row) => sum + row.weighted, 0);
  const headline = shown.length
    ? `${format.compact(forecast)} USD weighted pipeline expected `
      + `${quarter ? `in ${quarter}` : `from ${shown[0].quarter} to ${shown[shown.length - 1].quarter}`}`
    : 'No open deals match';

  return (
    <AppTheme theme="powerapps-df">
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <AppHeader
            kicker="Sales forecast"
            title={headline}
            deck={'Open opportunities by the month they are expected to close. '
              + 'Weighted pipeline is estimated value times probability.'}
            source="Dataverse (Power Apps)"
          />
          <FilterBar>
            <ValueSelect
              table="forecast_by_month"
              column="product_line"
              label="Product line"
              value={product}
              onChange={setProduct}
            />
            <ValueSelect
              table="forecast_by_month"
              column="quarter"
              label="Quarter"
              value={quarter}
              onChange={setQuarter}
              options={quarters.map(row => row.quarter)}
            />
          </FilterBar>
          <KpiStrip>
            {quarters.map(row => (
              <Kpi
                key={row.quarter}
                label={`${row.quarter} weighted (USD)`}
                value={row.weighted}
                format="compact"
                note={`${format.number(row.deals, 0)} open deals`}
              />
            ))}
          </KpiStrip>
          <Grid container spacing={2} alignItems="stretch">
            <Grid size={{ xs: 12, md: 8 }}>
              <Tile title="Weighted pipeline by expected close month" subtitle="USD, by sales region">
                <FlintChart
                  chartType="Stacked Bar Chart"
                  query={byMonth}
                  height={320}
                  encodings={{ x: 'month', y: 'weighted_sum', color: 'region' }}
                  labels={{ month: '', weighted_sum: 'Weighted pipeline', region: 'Sales region' }}
                  semanticTypes={{ month: 'YearMonth', weighted_sum: 'Amount' }}
                />
              </Tile>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Tile title="By sales region" subtitle="Weighted pipeline, USD">
                <BarList
                  query={byRegion}
                  label="region"
                  value="weighted_sum"
                  format="compact"
                />
              </Tile>
            </Grid>
          </Grid>
          <Tile title="Deals behind the forecast" subtitle="The 25 with the biggest weighted value">
            <DataTable
              query={deals}
              maxHeight={380}
              columns={[
                { field: 'deal', label: 'Opportunity' },
                { field: 'account', label: 'Account' },
                { field: 'region', label: 'Sales region' },
                { field: 'stage', label: 'Stage' },
                { field: 'month', label: 'Expected close' },
                { field: 'value', label: 'Estimated value', format: 'compact', align: 'right' },
                { field: 'weighted', label: 'Weighted', format: 'compact', align: 'right', bar: true },
              ]}
            />
          </Tile>
        </Stack>
      </Container>
    </AppTheme>
  );
}
