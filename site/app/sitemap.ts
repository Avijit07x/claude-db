import type { MetadataRoute } from 'next';
import { DOCS, href } from '@/lib/docs';
import { SITE } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE, priority: 1 },
    ...DOCS.map((doc) => ({ url: `${SITE}${href(doc.slug)}`, priority: 0.8 })),
  ];
}
