import { createKudosHandler } from '@dockudos/next/kudos';

// Stores votes and comments in .dockudos/kudos.jsonl. Read them with `dockudos kudos`.
// On a host without a writable disk, pass your own store: createKudosHandler({ store }).
export const POST = createKudosHandler();
