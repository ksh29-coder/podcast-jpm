import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { api, type Chapter, type Cue } from '../../../lib/api';
import { formatTime } from '../../../lib/format';
import type { EpisodeStats as Stats, Headline } from '../../../lib/host';
import { colors, spacing, type } from '../../../theme';
import { useHost } from '../HostGate';
import { ui } from '../ui';
import { AUDIENCE_LABEL, count, duration, FEW, MODE_LABEL, percent, PLATFORM_LABEL, saidAt, SOURCE_LABEL, SplitBars, StatsSection, Tile, Tiles } from './parts';
import { RetentionChart } from './RetentionChart';

// An episode's listening stats for hosts (docs/listening-stats.md): totals
// only, never who, and nothing based on fewer than 5 people.
export function EpisodeStats({ episodeId, chapters }: { episodeId: string; chapters: Chapter[] }) {
  const { api: host } = useHost();
  const [stats, setStats] = useState<Stats | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    host.episodeStats(episodeId).then(setStats, (e) => setError(e instanceof Error ? e.message : String(e)));
    api.transcript(episodeId).then((t) => setCues(t.cues), () => setCues([]));
  }, [host, episodeId]);

  if (error) return <Text style={ui.error}>{error}</Text>;
  if (!stats) return <ActivityIndicator color={colors.accent} />;
  const d = stats.definitions;
  const updated = `Updated ${new Date(stats.refreshedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}; refreshed every ${d.REFRESH_MIN} minutes. Totals only: never who, and nothing based on fewer than ${d.MIN_PEOPLE} people.`;
  if (!stats.all.enough) {
    return (
      <View style={{ gap: spacing.xs }}>
        <Text style={ui.hint}>Fewer than {d.MIN_PEOPLE} listeners so far. Stats show once {d.MIN_PEOPLE} people have listened, so nobody can be singled out.</Text>
        <Text style={type.caption}>{updated}</Text>
      </View>
    );
  }
  const all = stats.all;
  const said = (t: number) => {
    const text = saidAt(cues, t);
    return text ? ` · “${text.length > 120 ? `${text.slice(0, 120)}…` : text}”` : '';
  };
  const span = (s: { fromSec: number; toSec: number }) => `${formatTime(s.fromSec)}–${formatTime(s.toSec)}`;

  return (
    <View style={{ gap: spacing.xl }}>
      <HeadlineTiles h={all} d={d} />
      {stats.firstDays && (
        <StatsSection title={`First ${d.FIRST_DAYS} days${stats.firstDays.complete ? '' : ' (so far)'}`}>
          {stats.firstDays.enough ? (
            <Tiles>
              <Tile label="Listeners" value={count(stats.firstDays.listeners)} />
              <Tile label="Plays" value={count(stats.firstDays.plays)} />
              <Tile label="Time listened" value={duration(stats.firstDays.timeListenedSec)} />
              <Tile label="Completed" value={percent(stats.firstDays.completionRate)} />
            </Tiles>
          ) : (
            <Text style={ui.hint}>{FEW} listeners in the first days.</Text>
          )}
        </StatsSection>
      )}

      {stats.retention && (
        <StatsSection title="Retention" hint="The share of listeners who heard each part of the episode. Drops are where people stopped or skipped ahead.">
          <RetentionChart durationSec={stats.durationSec} retention={stats.retention} fromShorts={stats.retentionFromShorts} chapters={chapters} cues={cues} />
        </StatsSection>
      )}

      {stats.moments && (
        <StatsSection title="Key moments">
          <Text style={ui.hint}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{percent(stats.moments.intro.share)}</Text> were still listening at {formatTime(stats.moments.intro.atSec)}.
          </Text>
          {stats.moments.drops.map((m) => (
            <Text key={`d${m.fromSec}`} style={ui.hint}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Drop</Text> {span(m)}: {percent(m.fromShare)} → {percent(m.toShare)}
              {said(m.fromSec)}
            </Text>
          ))}
          {stats.moments.skipped.map((m) => (
            <Text key={`s${m.fromSec}`} style={ui.hint}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Skipped</Text> {span(m)} by {m.people} people{said(m.fromSec)}
            </Text>
          ))}
          {stats.moments.replayed.map((m) => (
            <Text key={`r${m.fromSec}`} style={ui.hint}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Replayed</Text> {span(m)} by {m.people} people{said(m.fromSec)}
            </Text>
          ))}
          {!stats.moments.drops.length && !stats.moments.skipped.length && !stats.moments.replayed.length && <Text style={ui.hint}>No big drops, skips or replays.</Text>}
        </StatsSection>
      )}

      {stats.stopped && (
        <StatsSection title="Where people stopped" hint="Where listeners who didn’t finish it last got to.">
          {stats.stopped.length === 0 ? (
            <Text style={ui.hint}>No one place where {d.MIN_PEOPLE} or more stopped.</Text>
          ) : (
            stats.stopped.map((s) => (
              <Text key={s.fromSec} style={ui.hint}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{span(s)}</Text>: {s.people} people ({percent(s.share)}){said(s.fromSec)}
              </Text>
            ))
          )}
        </StatsSection>
      )}

      {stats.splits && (
        <StatsSection title="Who listened, and how">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl }}>
            <SplitBars title="Listening or watching" rows={stats.splits.mode} labels={MODE_LABEL} total={all.listeners} />
            <SplitBars title="On" rows={stats.splits.platform} labels={PLATFORM_LABEL} total={all.listeners} />
            <SplitBars title="Started from" rows={stats.splits.source} labels={SOURCE_LABEL} total={all.listeners} />
            <SplitBars title="New or returning" rows={stats.splits.audience} labels={AUDIENCE_LABEL} total={all.listeners} />
          </View>
        </StatsSection>
      )}
      <Text style={type.caption}>{updated}</Text>
    </View>
  );
}

export function HeadlineTiles({ h, d }: { h: Extract<Headline, { enough: true }>; d: Stats['definitions'] }) {
  return (
    <Tiles>
      <Tile label="Listeners" value={count(h.listeners)} hint={h.fromShorts.onlyShorts ? `${h.fromShorts.onlyShorts} only through Shorts` : undefined} />
      <Tile label="Plays" value={count(h.plays)} hint={`${d.PLAY_SEC}+ seconds heard`} />
      <Tile label="Engaged" value={count(h.engaged)} hint={`Heard ${Math.round(d.ENGAGED_SHARE * 100)}% or ${d.ENGAGED_SEC / 60} min`} />
      <Tile label="Completed" value={percent(h.completionRate)} hint={`${count(h.completed)} heard ${Math.round(d.COMPLETED_SHARE * 100)}%+`} />
      <Tile label="Time listened" value={duration(h.timeListenedSec)} hint={h.fromShorts.timeSec ? `${duration(h.fromShorts.timeSec)} through Shorts` : undefined} />
      <Tile label="Average heard" value={percent(h.avgConsumption)} hint="Of the episode, per listener" />
    </Tiles>
  );
}
