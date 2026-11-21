import { useMemo } from 'react';
import {
  Container,
  Grid,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import * as d3 from 'd3';
import { useQuery } from '@df/data';
import {
  AppHeader,
  AppTheme,
  useInks,
  useMeasure,
} from '@df/chart';
import { format } from '@df/format';

// One step: its text beside its picture.
function Step({ title, text, children }) {
  return (
    <Grid container spacing={4} alignItems="center">
      <Grid size={{ xs: 12, md: 4 }}>
        <Stack spacing={1.5}>
          <Typography variant="h5" component="h2">{title}</Typography>
          <Typography sx={{ fontSize: '1.0625rem', lineHeight: 1.65 }}>{text}</Typography>
        </Stack>
      </Grid>
      <Grid size={{ xs: 12, md: 8 }}>{children}</Grid>
    </Grid>
  );
}

// Every topic as a tile sized by its papers, grouped and coloured by area. `focus` picks an area or a
// topic (the rest fade); `highlights` shades each tile by its share of orals and spotlights instead.
function TopicMap({ rows, focus, highlights }) {
  const [ref, { width }] = useMeasure();
  const inks = useInks();
  const height = Math.round(Math.min(460, width * 0.62));
  const areas = useMemo(
    () => d3.groupSort(rows, items => -d3.sum(items, row => row.papers), row => row.area),
    [rows],
  );
  const leaves = useMemo(() => {
    if (!width || !rows.length) return [];
    const root = d3.hierarchy({
      children: areas.map(area => ({ area, children: rows.filter(row => row.area === area) })),
    }).sum(node => node.papers || 0).sort((a, b) => b.value - a.value);
    d3.treemap().size([width, height]).paddingInner(2).paddingOuter(1).round(true)(root);
    return root.leaves();
  }, [rows, areas, width, height]);
  const shade = d3.scaleLinear().domain([0, 12]).range([0.15, 1]).clamp(true);
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Topics by papers">
          {leaves.map(leaf => {
            const row = leaf.data;
            const picked = !focus || focus === row.area || focus === row.topic;
            const share = 100 * row.highlighted / row.papers;
            const w = leaf.x1 - leaf.x0;
            const h = leaf.y1 - leaf.y0;
            const opacity = highlights ? shade(share) : picked ? 0.9 : 0.18;
            return (
              <Tooltip
                key={`${row.area}-${row.topic}`}
                title={`${row.topic} (${row.area}): ${format.number(row.papers, 0)} papers, `
                  + `${format.number(row.highlighted, 0)} orals and spotlights`}
              >
                <g transform={`translate(${leaf.x0},${leaf.y0})`}>
                  <rect
                    width={w}
                    height={h}
                    rx={3}
                    fill={inks.palette[areas.indexOf(row.area) % inks.palette.length]}
                    fillOpacity={opacity}
                    style={{ transition: 'fill-opacity 500ms' }}
                  />
                  {w > 70 && h > 30 && (
                    <text x={6} y={16} fontSize={12} fontWeight={600} fill="#fff"
                      opacity={picked || highlights ? 1 : 0.4}>
                      {row.topic.length * 6.5 > w - 12 ? `${row.topic.slice(0, Math.floor((w - 20) / 6.5))}…` : row.topic}
                    </text>
                  )}
                  {w > 50 && h > 46 && (
                    <text x={6} y={32} fontSize={11} fill="#fff" opacity={picked || highlights ? 0.9 : 0.4}>
                      {highlights ? `${format.number(share, 0)}% highlighted` : format.number(row.papers, 0)}
                    </text>
                  )}
                </g>
              </Tooltip>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export default function App() {
  const topics = useQuery('topics_2026', { orderBy: [{ field: 'papers', descending: true }] });
  const rows = topics.rows;
  const areas = d3.rollups(rows, items => d3.sum(items, row => row.papers), row => row.area)
    .sort((a, b) => b[1] - a[1]);
  const total = d3.sum(rows, row => row.papers);
  const [topArea, topAreaPapers] = areas[0] || ['', 0];
  const topTopic = rows[0];
  const standout = [...rows]
    .filter(row => row.papers >= 50 && !/Everything Else|\(general\)/.test(row.topic))
    .sort((a, b) => b.highlighted / b.papers - a.highlighted / a.papers)[0];
  const steps = [
    {
      title: `${areas.length} areas, ${rows.length} topics`,
      text: `Each tile is one topic, sized by its NeurIPS 2026 papers (${format.number(total, 0)} with a topic) `
        + 'and coloured by its area, as authors chose them when they submitted.',
    },
    {
      title: `${topArea} is the biggest area`,
      text: `${format.number(topAreaPapers, 0)} papers, ${format.number(100 * topAreaPapers / (total || 1), 0)}% `
        + `of all. ${areas[1]?.[0] || ''} comes next, with ${format.number(areas[1]?.[1] || 0, 0)}.`,
      focus: topArea,
    },
    {
      title: topTopic ? `The biggest topic: ${topTopic.topic}` : 'The biggest topic',
      text: topTopic
        ? `${format.number(topTopic.papers, 0)} papers on ${topTopic.topic.toLowerCase()} alone, in `
          + `${topTopic.area.toLowerCase()}, more than any other single topic.`
        : '',
      focus: topTopic?.topic,
    },
    {
      title: 'Where the orals and spotlights go',
      text: standout
        ? `Shaded now by the share of each topic's papers chosen as orals or spotlights. Among topics with 50 `
          + `papers or more, ${standout.topic.toLowerCase()} has the most: `
          + `${format.number(100 * standout.highlighted / standout.papers, 0)}%.`
        : '',
      highlights: true,
    },
  ];

  return (
    <AppTheme theme="neurips-df" density="normal">
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack spacing={5}>
          <AppHeader
            variant="editorial"
            kicker="NeurIPS 2026"
            title={`${topArea} leads NeurIPS 2026; ${topTopic?.topic || ''} is its biggest topic`}
            deck="What the 9,000 papers of NeurIPS 2026 are about, by the topics their authors chose."
            source="__SOURCE__"
          />
          {steps.map(item => (
            <Step key={item.title} title={item.title} text={item.text}>
              <TopicMap rows={rows} focus={item.focus} highlights={item.highlights} />
            </Step>
          ))}
        </Stack>
      </Container>
    </AppTheme>
  );
}
