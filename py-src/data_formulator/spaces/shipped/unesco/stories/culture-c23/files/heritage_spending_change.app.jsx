// @df-app {"version": 2, "title": "Heritage spending since the pandemic", "tables": ["heritage_spending_change"]}
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

export default function App() {
  const changes = useQuery('heritage_spending_change', { orderBy: 'change', descending: true });
  // The biggest risers, before the pandemic and since.
  const risers = useSql(
    'with top as (select * from heritage_spending_change order by change desc limit 6) '
      + 'select country, \'Before the pandemic\' as period, before_pandemic as per_person from top '
      + 'union all select country, \'Latest\' as period, latest as per_person from top',
  );
  const rows = changes.rows;
  const up = rows.filter(row => row.change > 0);
  const down = rows.filter(row => row.change < 0);
  const top = rows[0];

  return (
    <AppTheme theme="uis">
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <AppHeader
            kicker="Heritage"
            title={top
              ? `${top.country} added the most heritage spending per person since the pandemic`
              : 'Heritage spending since the pandemic'}
            deck="Public heritage spending per person, latest year (2022–2024) against before the pandemic (2017–2019)."
            count={{ value: rows.length, noun: 'countries' }}
            source="UIS, February 2026 release; indicator HEXPCSTPPPCAP.HER.PU"
          />
          <KpiStrip>
            <Kpi
              label="Countries spending more"
              value={up.length}
              format="number"
              note={`of ${rows.length} with both figures`}
            />
            <Kpi
              label="Countries spending less"
              value={down.length}
              format="number"
              note={`of ${rows.length} with both figures`}
            />
            <Kpi
              label={`Biggest rise: ${top?.country ?? '—'}`}
              value={top?.change}
              format="number:0"
              unit="PPP$ a person"
              note={top ? `${format.number(top.before_pandemic, 0)} to ${format.number(top.latest, 0)}` : null}
            />
          </KpiStrip>
          <Grid container spacing={2} alignItems="flex-start">
            <Grid size={{ xs: 12, md: 7 }}>
              <Tile
                title={`${up.length} countries spend more than before the pandemic`}
                subtitle="Change in public heritage spending per person, PPP$"
                height={620}
              >
                <FlintChart
                  chartType="Bar Chart"
                  table="heritage_spending_change"
                  query={changes}
                  height="fill"
                  encodings={{
                    x: 'change',
                    y: { field: 'country', sortBy: 'x', sortOrder: 'descending' },
                  }}
                  labels={{ change: '', country: '' }}
                  focus={top ? { country: top.country } : null}
                  note="Biggest rise"
                />
              </Tile>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <Tile
                title="The biggest risers, before and after"
                subtitle="Public heritage spending per person, PPP$"
                height={620}
              >
                <FlintChart
                  chartType="Slope Chart"
                  query={risers}
                  height="fill"
                  encodings={{ x: 'period', y: 'per_person', color: 'country' }}
                  semanticTypes={{ per_person: 'Price' }}
                  labels={{ period: '', per_person: '', country: '' }}
                />
              </Tile>
            </Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 720 }}>
            Constant 2017 purchasing-power dollars, so changes are not due to inflation.
          </Typography>
        </Stack>
      </Container>
    </AppTheme>
  );
}
