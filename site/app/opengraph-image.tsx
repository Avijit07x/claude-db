import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'claude-db: persistent memory and a code graph for Claude Code';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#0b0d10',
          padding: '80px',
        }}
      >
        <div style={{ display: 'flex', color: '#d97757', fontSize: 26, letterSpacing: 4 }}>
          MEMORY + CODE GRAPH FOR CLAUDE CODE
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 28,
            color: '#ffffff',
            fontSize: 86,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2,
          }}
        >
          Stop paying Claude to
        </div>
        <div
          style={{
            display: 'flex',
            color: '#79828c',
            fontSize: 86,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2,
          }}
        >
          relearn your own repo.
        </div>
        <div style={{ display: 'flex', marginTop: 44, color: '#98a0a9', fontSize: 30 }}>
          npm install -g claude-db
        </div>
      </div>
    ),
    size,
  );
}
