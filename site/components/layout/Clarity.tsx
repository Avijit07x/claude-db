'use client';

import { useEffect } from 'react';
import clarity from '@microsoft/clarity';
import { CLARITY_ID } from '@/lib/site';

export function Clarity() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    clarity.init(CLARITY_ID);
  }, []);

  return null;
}
