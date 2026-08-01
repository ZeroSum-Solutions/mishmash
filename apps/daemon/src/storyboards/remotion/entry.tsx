// Bundle entry point for @remotion/bundler's bundle({ entryPoint }) — see
// render.ts's resolveEntryPoint. Never imported directly by daemon code;
// Remotion's own webpack bundler loads this file by path and runs it inside
// a headless Chrome tab.

import { Composition, registerRoot } from 'remotion';
import { calculateStoryboardFinishMetadata, StoryboardFinish, type StoryboardFinishProps } from './composition.js';
import { FPS } from './timeline.js';

export const STORYBOARD_FINISH_COMPOSITION_ID = 'storyboard-finish';

const DEFAULT_PROPS: StoryboardFinishProps = {
  clips: [],
  ratio: '16:9',
  title: { enabled: false, text: '' },
  transitionsEnabled: true,
  audioFileName: null,
  captions: null,
};

function Root() {
  return (
    <Composition
      id={STORYBOARD_FINISH_COMPOSITION_ID}
      component={StoryboardFinish}
      durationInFrames={FPS * 5}
      fps={FPS}
      width={1280}
      height={720}
      defaultProps={DEFAULT_PROPS}
      calculateMetadata={calculateStoryboardFinishMetadata}
    />
  );
}

registerRoot(Root);
