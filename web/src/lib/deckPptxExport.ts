import { api } from "./api";
import { sanitizeFilenamePart } from "./image-downloads";
import type { Deck, DeckSlide } from "./types";

const SLIDE_WIDTH_IN = 13.333;
const SLIDE_HEIGHT_IN = 7.5;
const DEFAULT_IMAGE_FETCH_CONCURRENCY = 3;

export interface DeckPptxExportProgress {
  completed: number;
  total: number;
}

export interface DeckPptxExportOptions {
  imageFetchConcurrency?: number;
  onProgress?: (progress: DeckPptxExportProgress) => void;
}

export function deckExportableSlides(deck: Pick<Deck, "slides">): DeckSlide[] {
  return [...deck.slides]
    .filter((slide) => Boolean(slide.image_url))
    .sort((left, right) => left.order_index - right.order_index);
}

export function deckPptxFilename(title: string): string {
  return `${sanitizeFilenamePart(title, "deck")}.pptx`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }),
  );
  return results;
}

export async function exportDeckAsPptx(deck: Deck, options: DeckPptxExportOptions = {}): Promise<void> {
  const slides = deckExportableSlides(deck);
  if (!slides.length) {
    throw new Error("没有可导出的已生成页面");
  }

  let completed = 0;
  const total = slides.length;
  options.onProgress?.({ completed, total });
  const slideImages = await mapWithConcurrency(
    slides,
    options.imageFetchConcurrency ?? DEFAULT_IMAGE_FETCH_CONCURRENCY,
    async (slide) => {
      const dataUrl = await api.fetchApiDataUrl(slide.image_url as string);
      completed += 1;
      options.onProgress?.({ completed, total });
      return { slide, dataUrl };
    },
  );

  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Inspiration One";
  pptx.company = "Inspiration One";
  pptx.subject = deck.title;
  pptx.title = deck.title;

  for (const { slide, dataUrl } of slideImages) {
    const pptxSlide = pptx.addSlide();
    pptxSlide.background = { color: "FFFFFF" };
    pptxSlide.addImage({
      data: dataUrl,
      x: 0,
      y: 0,
      w: SLIDE_WIDTH_IN,
      h: SLIDE_HEIGHT_IN,
    });
    const notes = slide.speaker_notes?.trim();
    if (deck.speaker_notes_enabled && notes) {
      pptxSlide.addNotes(notes);
    }
  }

  await pptx.writeFile({ fileName: deckPptxFilename(deck.title), compression: true });
}
