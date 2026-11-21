// @df-app {"version": 2, "title": "Who pays for heritage", "tables": ["heritage_spending_by_level"]}
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
  DataTable,
  FlintChart,
  Kpi,
  KpiStrip,
} from '@df/chart';

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
  const levels = useQuery('heritage_spending_by_level', { orderBy: 'local_share', descending: true });
  const rows = levels.rows;
  const national = rows.filter(row => row.national > row.local);
  const local = rows.filter(row => row.local >= row.national);
  const top = rows[0];

  return (
    <AppTheme theme="uis">
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <AppHeader
            kicker="Heritage"
            title={rows.length
              ? `National governments outspend local ones in ${national.length} of ${rows.length} countries`
              : 'Who pays for heritage'}
            deck="Public spending on heritage per person by national and local governments, latest year with both."
            count={{ value: rows.length, noun: 'countries' }}
            source="UIS, February 2026 release; indicators HEXPCSTPPPCAPGOV.NTL.HER.PU, HEXPCSTPPPCAPGOV.LOC.HER.PU"
          />
          <KpiStrip>
            <Kpi
              label="National governments spend more"
              value={national.length}
              format="number"
              note={`of ${rows.length} countries`}
            />
            <Kpi
              label="Local governments spend more"
              value={local.length}
              format="number"
              note={`of ${rows.length} countries`}
            />
            <Kpi
              label={`Highest local share: ${top?.country ?? '—'}`}
              value={top ? top.local_share / 100 : null}
              format="percent"
              note="of national and local spending"
            />
          </KpiStrip>
          <Grid container spacing={2} alignItems="flex-start">
            <Grid size={{ xs: 12, md: 7 }}>
              <Tile
                title={top ? `In ${top.country}, towns and cities pay the most` : 'Local share'}
                subtitle="Local governments' share of national and local heritage spending, %"
                height={640}
              >
                <FlintChart
                  chartType="Bar Chart"
                  table="heritage_spending_by_level"
                  query={levels}
                  height="fill"
                  encodings={{
                    x: 'local_share',
                    y: { field: 'country', sortBy: 'x', sortOrder: 'descending' },
                  }}
                  labels={{ local_share: '', country: '' }}
                  focus={top ? { country: top.country } : null}
                  note="Highest local share"
                />
              </Tile>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <Tile
                title="Where local governments spend more"
                subtitle="Public heritage spending per person, PPP$"
              >
                <DataTable
                  data={local}
                  columns={[
                    { field: 'country', label: 'Country' },
                    { field: 'latest_year', label: 'Year' },
                    { field: 'national', label: 'National', format: 'number:1' },
                    { field: 'local', label: 'Local', format: 'number:1', bar: true },
                  ]}
                />
              </Tile>
            </Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 720 }}>
            Regional governments are left out. Constant 2017 purchasing-power dollars.
          </Typography>
        </Stack>
      </Container>
    </AppTheme>
  );
}
