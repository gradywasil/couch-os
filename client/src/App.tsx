import React, { Suspense, lazy } from 'react';

// Route-level code splitting: a phone opening /play only downloads the
// controller, never the 60 game engines or the RetroArch emulator.
const HostPage = lazy(() =>
  import('./pages/HostPage').then((m) => ({ default: m.HostPage })),
);
const ControllerPage = lazy(() =>
  import('./pages/ControllerPage').then((m) => ({ default: m.ControllerPage })),
);
const TvReceiverPage = lazy(() =>
  import('./pages/TvReceiverPage').then((m) => ({ default: m.TvReceiverPage })),
);

function BootSplash(): React.ReactElement {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#07060B]">
      <div className="flex flex-col items-center gap-4">
        <span className="w-14 h-3 rounded-full smpte-bar animate-pulse" />
        <span className="font-brand font-extrabold text-2xl tracking-tight text-white">
          COUCH·OS
        </span>
      </div>
    </div>
  );
}

function routeCode(path: string, prefix: string): string {
  return path.slice(prefix.length).replace(/^\/+/, '').split('/')[0] ?? '';
}

export function App(): React.ReactElement {
  const path = window.location.pathname;

  let page: React.ReactElement;
  if (path.startsWith('/play')) {
    page = <ControllerPage initialRoomCode={routeCode(path, '/play')} />;
  } else if (path.startsWith('/tv')) {
    page = <TvReceiverPage initialRoomCode={routeCode(path, '/tv')} />;
  } else {
    page = <HostPage />;
  }

  return <Suspense fallback={<BootSplash />}>{page}</Suspense>;
}

export default App;
