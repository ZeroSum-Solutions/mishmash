// The Remotion composition for the storyboard finishing pass: title card +
// crossfade transitions between shots + burned-in captions. This file is
// never imported by the daemon's own Node module graph — render.ts only
// references it by file PATH (see resolveEntryPoint in render.ts), because
// @remotion/bundler bundles it into a standalone browser-runnable page that a
// headless Chrome instance renders frame-by-frame. Assets (clip files, the
// narration track) are referenced via `staticFile()`, which resolves against
// the bundle's public dir — see render.ts for why that's the only way
// Remotion can read caller-supplied local files here (its asset downloader
// only accepts http(s):// and data: URLs, so plain absolute paths don't
// work).

import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  type CalculateMetadataFunction,
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { createTikTokStyleCaptions, type Caption, type TikTokPage } from '@remotion/captions';
import { FPS, dimensionsForRatio, planTimeline, type TimelineClip } from './timeline.js';

export interface StoryboardFinishProps extends Record<string, unknown> {
  clips: TimelineClip[];
  ratio: string;
  title: { enabled: boolean; text: string };
  transitionsEnabled: boolean;
  audioFileName: string | null;
  captions: Caption[] | null;
}

const CAPTION_COMBINE_MS = 1200;

export const calculateStoryboardFinishMetadata: CalculateMetadataFunction<StoryboardFinishProps> = ({ props }) => {
  const plan = planTimeline({
    clips: props.clips,
    titleEnabled: props.title.enabled,
    transitionsEnabled: props.transitionsEnabled,
  });
  const { width, height } = dimensionsForRatio(props.ratio);
  return { durationInFrames: plan.totalDurationInFrames, fps: FPS, width, height };
};

function TitleCard({ text }: { text: string }) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#0b0b0c', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          color: '#fff',
          fontSize: 64,
          fontWeight: 600,
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: '0 80px',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}

function ClipFrame({ fileName }: { fileName: string }) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <OffthreadVideo src={staticFile(fileName)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
}

function CaptionOverlay({ pages }: { pages: TikTokPage[] }) {
  const frame = useCurrentFrame();
  const ms = (frame / FPS) * 1000;
  const active = pages.find((page) => ms >= page.startMs && ms < page.startMs + page.durationMs);
  if (!active) return null;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 64 }}>
      <div
        style={{
          maxWidth: '80%',
          textAlign: 'center',
          color: '#fff',
          background: 'rgba(0,0,0,0.65)',
          padding: '10px 20px',
          borderRadius: 10,
          fontFamily: 'system-ui, sans-serif',
          fontSize: 40,
          fontWeight: 600,
        }}
      >
        {active.text}
      </div>
    </AbsoluteFill>
  );
}

export function StoryboardFinish({ clips, title, transitionsEnabled, audioFileName, captions }: StoryboardFinishProps) {
  const plan = planTimeline({ clips, titleEnabled: title.enabled, transitionsEnabled });
  const pages = captions
    ? createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: CAPTION_COMBINE_MS }).pages
    : [];
  // plan.transitionFrames[i] is the transition BETWEEN segment i and i+1,
  // where segment 0 is the title (when enabled) and the rest are clips — see
  // planTimeline's doc comment. Each entry is already clamped to the shorter
  // neighbor, so passing it straight through never exceeds either sequence's
  // own duration (the thing TransitionSeries throws on otherwise).
  const titleToFirstClipTransition = title.enabled ? (plan.transitionFrames[0] ?? 0) : 0;
  const clipGapTransition = (clipIndex: number) => {
    const transitionIndex = title.enabled ? clipIndex + 1 : clipIndex;
    return plan.transitionFrames[transitionIndex] ?? 0;
  };

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <TransitionSeries>
        {title.enabled && (
          <TransitionSeries.Sequence durationInFrames={plan.titleFrames}>
            <TitleCard text={title.text} />
          </TransitionSeries.Sequence>
        )}
        {title.enabled && transitionsEnabled && titleToFirstClipTransition > 0 && (
          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({ durationInFrames: titleToFirstClipTransition })}
          />
        )}
        {clips.map((clip, index) => {
          const gapTransition = clipGapTransition(index);
          return (
            <React.Fragment key={clip.fileName}>
              <TransitionSeries.Sequence durationInFrames={plan.clipFrames[index] ?? 1}>
                <ClipFrame fileName={clip.fileName} />
              </TransitionSeries.Sequence>
              {transitionsEnabled && index < clips.length - 1 && gapTransition > 0 && (
                <TransitionSeries.Transition
                  presentation={fade()}
                  timing={linearTiming({ durationInFrames: gapTransition })}
                />
              )}
            </React.Fragment>
          );
        })}
      </TransitionSeries>
      {audioFileName && (
        <Sequence from={plan.titleFrames} durationInFrames={plan.totalDurationInFrames - plan.titleFrames}>
          <Audio src={staticFile(audioFileName)} />
          {pages.length > 0 && <CaptionOverlay pages={pages} />}
        </Sequence>
      )}
    </AbsoluteFill>
  );
}
