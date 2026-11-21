// @df-app {"version": 2, "title": "Learning to read by the end of primary school", "tables": ["primary_reading_proficiency"]}
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
  BarList,
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

const percent = value => `${format.number(value, 0)}%`;

export default function App() {
  const all = useQuery('primary_reading_proficiency', { orderBy: 'reading', descending: true, limit: 500 });
  const best = useQuery('primary_reading_proficiency', { orderBy: 'reading', descending: true, limit: 6 });
  const worst = useQuery('primary_reading_proficiency', { orderBy: 'reading', limit: 6 });
  // Countries in each 10-point band of the share reaching the level (100% falls in the top band).
  const bands = useSql(
    'select cast(least(floor(reading / 10), 9) * 10 as integer) as low, count(*) as countries '
      + 'from primary_reading_proficiency group by 1 order by 1',
  );
  const banded = bands.rows.map(row => ({ band: `${row.low}–${row.low + 10}%`, countries: row.countries }));
  const rows = all.rows;
  const nearlyAll = rows.filter(row => row.reading >= 90).length;
  const underHalf = rows.filter(row => row.reading < 50).length;

  return (
    <AppTheme theme="uis">
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <AppHeader
            kicker="Learning to read"
            title={rows.length
              ? `Nearly every pupil reads in ${nearlyAll} countries; fewer than half do in ${underHalf}`
              : 'Learning to read'}
            deck="Share of pupils reaching minimum reading proficiency by the end of primary school, latest assessment."
            count={{ value: rows.length, noun: 'countries' }}
            source="UIS, November 2026 release; indicator READ.PRIMARY"
          />
          <KpiStrip>
            <Kpi
              label="Countries where 90% or more read"
              value={nearlyAll}
              format="number"
              note={`of ${rows.length} assessed`}
            />
            <Kpi
              label="Countries where under half read"
              value={underHalf}
              format="number"
              note={`of ${rows.length} assessed`}
            />
            <Kpi
              label={`Highest: ${rows[0]?.country ?? '—'}`}
              value={rows[0] ? rows[0].reading / 100 : null}
              format="percent"
              note={rows[0] ? `assessed ${rows[0].latest_year}` : null}
            />
          </KpiStrip>
          <Grid container spacing={2} alignItems="flex-start">
            <Grid size={{ xs: 12, md: 7 }}>
              <Tile
                title="Countries split between near all and under half"
                subtitle="Number of countries by share of pupils reaching the reading level, %"
                height={460}
              >
                <FlintChart
                  chartType="Bar Chart"
                  data={banded}
                  height="fill"
                  encodings={{ x: 'band', y: 'countries' }}
                  semanticTypes={{ countries: 'Count' }}
                  labels={{ band: '', countries: '' }}
                />
              </Tile>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <Stack spacing={2}>
                <Tile title="Where nearly every pupil reads" subtitle="Highest shares, %">
                  <BarList query={best} label="country" value="reading" format={percent} limit={6} />
                </Tile>
                <Tile title="Where most pupils do not" subtitle="Lowest shares, %">
                  <BarList query={worst} label="country" value="reading" format={percent} limit={6} />
                </Tile>
              </Stack>
            </Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 720 }}>
            National and international assessments differ in what they test; compare countries with care.
          </Typography>
        </Stack>
      </Container>
    </AppTheme>
  );
}
