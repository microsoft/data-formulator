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

const COUNTRY = 'South Korea';

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

const ordinal = rank => {
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[rank % 10] ?? 'th');
  return `${rank}${suffix}`;
};

export default function App() {
  const all = useQuery('research_rankings', { limit: 500 });
  const spending = useSql(
    'select country, rd_share from research_rankings where rd_share is not null '
      + 'order by rd_share desc limit 10',
  );
  const researchers = useSql(
    'select country, researchers_per_million from research_rankings '
      + 'where researchers_per_million is not null order by researchers_per_million desc limit 10',
  );
  const korea = all.rows.find(row => row.country === COUNTRY);
  const ranked = field => all.rows.filter(row => row[field] !== null).length;
  const spendingRank = korea?.rd_share_rank;
  const researchersRank = korea?.researchers_rank;
  const focus = { country: COUNTRY };

  return (
    <AppTheme theme="uis">
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <AppHeader
            kicker="Research"
            title={korea
              ? `${COUNTRY} ranks ${ordinal(spendingRank)} in research spending `
                + `and ${ordinal(researchersRank)} in researchers`
              : COUNTRY}
            deck="Research spending as a share of GDP and researchers per million people, latest figures."
            period={[2020, 2024]}
            source="__SOURCE__"
          />
          <KpiStrip>
            <Kpi
              label="Research spending"
              value={korea?.rd_share}
              format="number:2"
              unit="% of GDP"
              note={korea ? `${ordinal(spendingRank)} of ${ranked('rd_share')}, ${korea.spending_year}` : null}
            />
            <Kpi
              label="Researchers per million people"
              value={korea?.researchers_per_million}
              format="number"
              note={korea
                ? `${ordinal(researchersRank)} of ${ranked('researchers_per_million')}, ${korea.researchers_year}`
                : null}
            />
          </KpiStrip>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Tile
                title={`${COUNTRY} spends ${format.number(korea?.rd_share, 2)}% of GDP on research`}
                subtitle="Research spending, % of GDP, top 10"
                height={400}
              >
                <FlintChart
                  chartType="Bar Chart"
                  table="research_rankings"
                  query={spending}
                  height="fill"
                  encodings={{
                    x: 'rd_share',
                    y: { field: 'country', sortBy: 'x', sortOrder: 'descending' },
                  }}
                  labels={{ rd_share: '', country: '' }}
                  focus={focus}
                  note={spendingRank ? ordinal(spendingRank) : undefined}
                />
              </Tile>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Tile
                title={`${COUNTRY} has ${format.number(korea?.researchers_per_million)} researchers per million`}
                subtitle="Researchers per million people (full-time equivalent), top 10"
                height={400}
              >
                <FlintChart
                  chartType="Bar Chart"
                  table="research_rankings"
                  query={researchers}
                  height="fill"
                  encodings={{
                    x: 'researchers_per_million',
                    y: { field: 'country', sortBy: 'x', sortOrder: 'descending' },
                  }}
                  labels={{ researchers_per_million: '', country: '' }}
                  focus={focus}
                  note={researchersRank ? ordinal(researchersRank) : undefined}
                />
              </Tile>
            </Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 720 }}>
            Each country's latest figure from 2020–2024; territories under 100,000 people left out.
          </Typography>
        </Stack>
      </Container>
    </AppTheme>
  );
}
