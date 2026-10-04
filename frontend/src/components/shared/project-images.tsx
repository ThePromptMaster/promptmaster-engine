'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { imageBriefs, projectImages, type ImageBrief } from '@/lib/data/images';
import { signedFileUrls } from '@/lib/supabase/project-files';
import type { ProjectFile } from '@/types/project';

/**
 * The project's images, as links that can be drawn now.
 *
 * Text holds `project-file:<id>`; the bucket is private, so drawing one needs
 * a signed link, fetched once per page for every image the project has.
 */
const ImagesContext = createContext<{ urls: Record<string, string>; images: ImageBrief[] }>({ urls: {}, images: [] });

export function ProjectImagesProvider({ files, children }: { files: readonly ProjectFile[] | undefined; children: ReactNode }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const images = projectImages(files);
  const key = images.map((f) => f.id).join(',');
  useEffect(() => {
    if (!images.length) {
      setUrls({});
      return;
    }
    let live = true;
    signedFileUrls(images)
      .then((map) => live && setUrls(map))
      .catch(() => live && setUrls({}));
    return () => {
      live = false;
    };
    // Keyed on the ids: a new array with the same images must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <ImagesContext.Provider value={{ urls, images: imageBriefs(files) }}>{children}</ImagesContext.Provider>;
}

export function useProjectImageUrls(): Record<string, string> {
  return useContext(ImagesContext).urls;
}

/** The project's images, for a control that places one. */
export function useProjectImageList(): ImageBrief[] {
  return useContext(ImagesContext).images;
}
