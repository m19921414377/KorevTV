"use client";

import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';

import { getAllFavorites, getAllPlayRecords } from '@/lib/db.client';
import { Favorite, PlayRecord } from '@/lib/types';
import ScrollableRow from '@/components/ScrollableRow';
import SectionTitle from '@/components/SectionTitle';
import VideoCard from '@/components/VideoCard';

type Weights = {
  wFav: number;
  wRecency: number;
  wProgress: number;
  decayDays: number;
  maxItems: number;
};

function daysSince(ts: number): number {
  const now = Date.now();
  return Math.max(0, (now - ts) / (1000 * 60 * 60 * 24));
}

function recencyScore(days: number, decayDays: number): number {
  if (decayDays <= 0) return 0;
  return Math.exp(-days / decayDays);
}

export default function ForYouRow() {
  const [favorites, setFavorites] = useState<Record<string, Favorite>>({});
  const [records, setRecords] = useState<Record<string, PlayRecord>>({});
  const [weights, setWeights] = useState<Weights>({
    wFav: 3.0,
    wRecency: 2.0,
    wProgress: 1.5,
    decayDays: 7,
    maxItems: 12,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fav, rec] = await Promise.all([
          getAllFavorites(),
          getAllPlayRecords(),
        ]);
        if (alive) {
          setFavorites(fav || {});
          setRecords(rec || {});
        }
      } catch {}
      // 拉取系统权重（若已配置）
      try {
        const res = await fetch('/api/admin/ai-recommend', { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          if (data?.recommendWeights) {
            setWeights((w) => ({
              ...w,
              wFav: Number(data.recommendWeights.wFav ?? w.wFav),
              wRecency: Number(data.recommendWeights.wRecency ?? w.wRecency),
              wProgress: Number(data.recommendWeights.wProgress ?? w.wProgress),
              decayDays: Number(data.recommendWeights.decayDays ?? w.decayDays),
              maxItems: Number(data.recommendWeights.maxItems ?? w.maxItems),
            }));
          }
        }
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  const items = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{
      key: string;
      title: string;
      cover: string;
      source_name: string;
      year: string;
      episodes: number;
      score: number;
      progressRatio: number;
      lastSaved: number;
    }> = [];

    const favKeys = Object.keys(favorites);
    const recKeys = Object.keys(records);

    const favSet = new Set(favKeys);

    // 合并播放记录
    recKeys.forEach((key) => {
      const r = records[key];
      const idKey = `${r.title}_${r.source_name}_${r.year}`;
      if (seen.has(idKey)) return;
      seen.add(idKey);

      const d = daysSince(r.save_time || Date.now());
      const progressRatio = r.total_time > 0 ? Math.min(1, (r.play_time || 0) / r.total_time) : 0;
      const score =
        (favSet.has(key) ? weights.wFav : 0) +
        weights.wRecency * recencyScore(d, weights.decayDays) +
        weights.wProgress * (1 - progressRatio);

      list.push({
        key,
        title: r.title,
        cover: r.cover,
        source_name: r.source_name,
        year: r.year,
        episodes: r.total_episodes || 1,
        score,
        progressRatio,
        lastSaved: r.save_time || 0,
      });
    });

    // 合并收藏（没有播放记录的）
    favKeys.forEach((key) => {
      const f = favorites[key];
      const idKey = `${f.title}_${f.source_name}_${f.year}`;
      if (seen.has(idKey)) return;
      seen.add(idKey);

      const d = daysSince(f.save_time || Date.now());
      const score = weights.wFav + weights.wRecency * recencyScore(d, weights.decayDays);
      list.push({
        key,
        title: f.title,
        cover: f.cover,
        source_name: f.source_name,
        year: f.year,
        episodes: f.total_episodes || 1,
        score,
        progressRatio: 0,
        lastSaved: f.save_time || 0,
      });
    });

    // 排序：score 降序，其次最近时间
    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.lastSaved || 0) - (a.lastSaved || 0);
    });

    return list.slice(0, weights.maxItems);
  }, [favorites, records, weights]);

  return (
    <section className='mb-8'>
      <div className='mb-4 flex items-center justify-between'>
        <SectionTitle title='为你推荐' icon={Sparkles} iconColor='text-purple-500' />
        <div className='flex items-center gap-2 text-xs'>
          <label className='flex items-center gap-1'>
            收藏权重
            <input type='range' min={0} max={5} step={0.5} value={weights.wFav}
              onChange={(e) => setWeights((w) => ({ ...w, wFav: Number(e.target.value) }))} />
          </label>
          <label className='flex items-center gap-1'>
            近期权重
            <input type='range' min={0} max={5} step={0.5} value={weights.wRecency}
              onChange={(e) => setWeights((w) => ({ ...w, wRecency: Number(e.target.value) }))} />
          </label>
          <label className='flex items-center gap-1'>
            未看完权重
            <input type='range' min={0} max={5} step={0.5} value={weights.wProgress}
              onChange={(e) => setWeights((w) => ({ ...w, wProgress: Number(e.target.value) }))} />
          </label>
        </div>
      </div>

      <ScrollableRow>
        {items.map((it, idx) => (
          <div key={`${it.key}-${idx}`} className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'>
            <VideoCard
              from='search'
              id={it.key}
              title={it.title}
              poster={it.cover}
              year={it.year}
              source_name={it.source_name}
              episodes={it.episodes}
              query={it.title}
              remarks={it.progressRatio > 0 ? `已看 ${(it.progressRatio * 100).toFixed(0)}%` : undefined}
            />
          </div>
        ))}
      </ScrollableRow>
    </section>
  );
}