// @df-app {"version": 2, "title": "Rich and poor in finishing school", "tables": ["completion_by_wealth"]}
import {
  Container,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery, useSql } from '@df/data';
import {
  AppHeader,
  AppTheme,
  FlintChart,
  Kpi,
  KpiStrip,
} from '@df/chart';
import { format } from '@df/format';

function Tile({ title, subtitle, caption, height = '100%', children }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, height, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Stack spacing={0.25}>
        <Typography variant="subtitle1" fontWeight={600}>{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
        )}
      </Stack>
      {children}
      {caption && (
        <Typography variant="caption" color="text.secondary">{caption}</Typography>
      )}
    </Paper>
  );
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export default function App() {
  const all = useQuery('completion_by_wealth', { orderBy: 'gap', descending: true, limit: 500 });
  // The widest gaps, one row per country and household group, for the dumbbells.
  const widest = useSql(
    'with top as (select * from completion_by_wealth order by gap desc limit 12) '
      + 'select country, gap, \'Poorest fifth\' as households, poorest as completion from top '
      + 'union all select country, gap, \'Richest fifth\' as households, richest as completion from top',
  );
  const rows = all.rows;
  const top = rows[0];
  const typical = rows.length ? median(rows.map(row => row.gap)) : null;
  const fewPoor = rows.filter(row => row.poorest < 20).length;

  return (
    <AppTheme theme="uis">
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <AppHeader
            kicker="Finishing school"
            title={top
              ? `In ${top.country}, the richest finish upper secondary school ${format.number(top.gap, 0)} points more often`
              : 'Rich and poor in finishing school'}
            deck="Upper secondary completion for the richest and poorest fifth of households, latest survey per country."
            count={{ value: rows.length, noun: 'countries' }}
            source="UIS, November 2026 release; indicators CR.3.Q1, CR.3.Q5"
          />
          <KpiStrip>
            <Kpi
              label={`Widest gap: ${top?.country ?? '—'}`}
              value={top?.gap}
              format="number:0"
              unit="points"
              note={top ? `${format.number(top.richest, 0)}% against ${format.number(top.poorest, 0)}%, ${top.latest_year}` : null}
            />
            <Kpi
              label="Gap in the typical country"
              value={typical}
              format="number:0"
              unit="points"
              note={`of ${rows.length} countries`}
            />
            <Kpi
              label="Where under 1 in 5 of the poorest finish"
              value={fewPoor}
              format="number"
              note={`of ${rows.length} countries`}
            />
          </KpiStrip>
          <Grid container spacing={2} alignItems="flex-start">
            <Grid size={{ xs: 12, md: 7 }}>
              <Tile
                title="The widest gaps between richest and poorest"
                subtitle="Upper secondary completion, %, 12 widest gaps"
                height={480}
              >
                <FlintChart
                  chartType="Ranged Dot Plot"
                  query={widest}
                  height="fill"
                  encodings={{
                    y: { field: 'country', sortBy: 'gap', sortOrder: 'descending' },
                    x: 'completion',
                    color: 'households',
                  }}
                  semanticTypes={{ completion: 'Percentage' }}
                  labels={{ country: '', completion: '', households: '' }}
                />
              </Tile>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <Tile
                title="The poorer the start, the wider the gap"
                subtitle="Each dot a country: poorest fifth across, richest fifth up, %"
                height={480}
              >
                <FlintChart
                  chartType="Scatter Plot"
                  table="completion_by_wealth"
                  query={all}
                  height="fill"
                  encodings={{ x: 'poorest', y: 'richest', detail: 'country' }}
                  labels={{ poorest: 'Poorest fifth', richest: 'Richest fifth' }}
                  focus={top ? { country: top.country } : null}
                  note={top?.country}
                />
              </Tile>
            </Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 720 }}>
            Household surveys, both sexes; each country's latest survey with both groups.
          </Typography>
        </Stack>
      </Container>
    </AppTheme>
  );
}
