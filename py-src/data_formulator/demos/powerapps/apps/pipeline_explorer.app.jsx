import { useMemo, useState } from 'react';
import {
  Box,
  Container,
  Grid,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import * as d3 from 'd3';
import { countries } from '@df/geo';
import { useQuery } from '@df/data';
import {
  AppHeader,
  AppTheme,
  DataTable,
  FilterBar,
  FlintChart,
  Kpi,
  KpiStrip,
  ValueSelect,
  queryFilters,
  useInks,
  useMeasure,
} from '@df/chart';
import { format } from '@df/format';

const STAGES = ['Qualify', 'Develop', 'Propose', 'Close'];

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

// Accounts on the world map, sized by open pipeline and coloured by sales region. Clicking one picks its
// region (again clears it). Antarctica (010) is left out: no accounts there, and it takes a third of the map.
function AccountMap({ rows, regions, region, onRegion }) {
  const [ref, { width }] = useMeasure();
  const inks = useInks();
  const height = Math.round(width * 0.48);
  const shapes = useMemo(() => countries().filter(shape => Number(shape.id) !== 10), []);
  const projection = useMemo(
    () => d3.geoNaturalEarth1().fitSize([width, height], { type: 'FeatureCollection', features: shapes }),
    [width, height, shapes],
  );
  const path = d3.geoPath(projection);
  const colour = d3.scaleOrdinal(regions, inks.palette);
  const radius = d3.scaleSqrt()
    .domain([0, d3.max(rows, row => row.value_sum) || 1])
    .range([3, Math.max(8, width / 28)]);
  // Big bubbles first, so small ones stay on top and can be hovered.
  const placed = rows
    .filter(row => row.lat != null && row.lon != null)
    .sort((a, b) => b.value_sum - a.value_sum);
  return (
    <Stack spacing={1}>
      <div ref={ref}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Accounts by open pipeline">
            {shapes.map(shape => (
              <path key={shape.id} d={path(shape)} fill={inks.grid} stroke={inks.surface} strokeWidth={0.5} />
            ))}
            {placed.map(row => {
              const [x, y] = projection([row.lon, row.lat]);
              const dimmed = region && row.region !== region;
              return (
                <Tooltip
                  key={row.account}
                  title={`${row.account} (${row.country}): ${format.compact(row.value_sum)} USD open`}
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={radius(row.value_sum)}
                    fill={colour(row.region)}
                    fillOpacity={dimmed ? 0.15 : 0.7}
                    stroke={inks.surface}
                    strokeWidth={1}
                    style={{ cursor: 'pointer', transition: 'fill-opacity 300ms' }}
                    onClick={() => onRegion(region === row.region ? '' : row.region)}
                  />
                </Tooltip>
              );
            })}
          </svg>
        )}
      </div>
      <Stack direction="row" flexWrap="wrap" columnGap={2} rowGap={0.5} alignItems="center">
        {regions.map(name => (
          <Stack key={name} direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: colour(name) }} />
            <Typography variant="caption">{name}</Typography>
          </Stack>
        ))}
        <Typography variant="caption" color="text.secondary">
          Bubble size: open pipeline. Click one to pick its region.
        </Typography>
      </Stack>
    </Stack>
  );
}

const total = (rows, field) => rows.reduce((sum, row) => sum + (row[field] || 0), 0);

export default function App() {
  const [region, setRegion] = useState('');
  const [product, setProduct] = useState('');
  const [stage, setStage] = useState('');
  const where = queryFilters({ region, product_line: product, stage });
  const deals = useQuery('open_deals', {
    filters: where,
    orderBy: [{ field: 'weighted', descending: true }],
  });
  // The map keeps every region (the one picked stands out), so it leaves out its own filter.
  const accounts = useQuery('open_deals', {
    columns: ['account', 'country', 'region', 'lat', 'lon'],
    filters: queryFilters({ product_line: product, stage }),
    aggregates: [{ op: 'sum', field: 'value' }],
  });
  // The stage chart keeps every stage, so it leaves out its own filter.
  const byStage = useQuery('open_deals', {
    columns: ['stage'],
    filters: queryFilters({ region, product_line: product }),
    aggregates: [{ op: 'sum', field: 'value' }],
  });

  const rows = deals.rows;
  const pipeline = total(rows, 'value');
  const weighted = total(rows, 'weighted');
  const topAccount = accounts.rows.filter(row => !region || row.region === region).reduce((best, row) => (
    !best || row.value_sum > best.value_sum ? row : best
  ), null);
  const regions = useMemo(
    () => [...new Set(accounts.rows.map(row => row.region))].filter(Boolean).sort(),
    [accounts.rows],
  );
  const scope = [region, product, stage].filter(Boolean).join(' · ') || 'All open deals';
  const headline = rows.length
    ? `${format.compact(pipeline)} USD open across ${format.number(rows.length, 0)} deals`
    : 'No open deals match';

  return (
    <AppTheme theme="powerapps-df">
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <AppHeader
            kicker="Pipeline explorer"
            title={headline}
            deck={`${scope}. Open opportunities in Dataverse, with their accounts on the map.`}
            source="__SOURCE__"
          />
          <FilterBar>
            <ValueSelect
              table="open_deals"
              column="region"
              label="Sales region"
              value={region}
              onChange={setRegion}
            />
            <ValueSelect
              table="open_deals"
              column="product_line"
              label="Product line"
              value={product}
              onChange={setProduct}
            />
            <ValueSelect
              table="open_deals"
              column="stage"
              label="Sales stage"
              value={stage}
              onChange={setStage}
              options={STAGES}
            />
          </FilterBar>
          <KpiStrip>
            <Kpi label="Open pipeline (USD)" value={pipeline} format="compact" />
            <Kpi
              label="Weighted pipeline (USD)"
              value={weighted}
              format="compact"
              note="Estimated value × probability"
            />
            <Kpi label="Open deals" value={rows.length} format="number" />
            <Kpi
              label="Top account"
              value={topAccount ? topAccount.value_sum : null}
              format="compact"
              note={topAccount ? topAccount.account : ''}
            />
          </KpiStrip>
          <Grid container spacing={2} alignItems="stretch">
            <Grid size={{ xs: 12, md: 8 }}>
              <Tile title="Where the open pipeline is" subtitle="Accounts sized by open pipeline (USD)">
                <AccountMap
                  rows={accounts.rows}
                  regions={regions}
                  region={region}
                  onRegion={setRegion}
                />
              </Tile>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Tile title="Pipeline by sales stage" subtitle="Estimated value, USD">
                <FlintChart
                  chartType="Bar Chart"
                  query={byStage}
                  height="fill"
                  encodings={{
                    x: 'value_sum',
                    y: { field: 'stage', sortBy: 'x', sortOrder: 'descending' },
                  }}
                  labels={{ value_sum: '', stage: '' }}
                  semanticTypes={{ value_sum: 'Amount' }}
                />
              </Tile>
            </Grid>
          </Grid>
          <Tile title="Open deals" subtitle="Biggest weighted value first">
            <DataTable
              query={deals}
              maxHeight={380}
              columns={[
                { field: 'deal', label: 'Opportunity' },
                { field: 'account', label: 'Account' },
                { field: 'stage', label: 'Stage' },
                { field: 'product_line', label: 'Product line' },
                { field: 'value', label: 'Estimated value', format: 'compact', align: 'right' },
                { field: 'probability', label: 'Probability %', format: 'number', align: 'right' },
                { field: 'weighted', label: 'Weighted', format: 'compact', align: 'right', bar: true },
                { field: 'estimated_close', label: 'Estimated close', format: 'date' },
              ]}
            />
          </Tile>
        </Stack>
      </Container>
    </AppTheme>
  );
}
