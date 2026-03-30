/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';

/**
 * PIXEL-BASED TEXT REFLOW ENGINE
 * 
 * How it works:
 * 1. Mask Generation: Every frame, we draw a black/white mask to an offscreen canvas.
 *    White represents free space (columns), black represents blocked space (margins, moving objects).
 * 2. Integral Image: We read the mask pixels using `getImageData` and compute an Integral Image (Summed Area Table).
 *    This allows us to query if ANY rectangular area contains black pixels in O(1) time.
 * 3. Layout Calculation: We iterate through pre-measured words. For each word, we check if its bounding box
 *    is free of black pixels using the Integral Image.
 *    - If free: We place the word and advance the X cursor.
 *    - If blocked: We advance the X cursor by a few pixels and check again.
 *    - If we reach the end of a column: We wrap to the next line.
 *    - If we reach the bottom of a column: We move to the next column.
 * 4. Rendering: Finally, we draw the background, the moving object, and the calculated text layout.
 */

const FONT_FAMILY = 'system-ui, -apple-system, sans-serif';

const textContent = [
  { type: 'heading', text: "NEWTON'S LAWS", font: `800 36px ${FONT_FAMILY}`, color: "#ffffff", lineHeight: 48 },
  { type: 'paragraph', text: "Sir Isaac Newton's three laws of motion describe the relationship between a body and the forces acting upon it, and its motion in response to those forces. More precisely, the first law defines the force qualitatively, the second law offers a quantitative measure of the force, and the third asserts that a single isolated force doesn't exist.", font: `400 14px ${FONT_FAMILY}`, color: "#a3a3a3", lineHeight: 22 },
  { type: 'heading', text: "I. INERTIA", font: `700 18px ${FONT_FAMILY}`, color: "#ff4444", lineHeight: 32 },
  { type: 'paragraph', text: "A body remains at rest, or in motion at a constant speed in a straight line, unless acted upon by a force. This is known as the law of inertia. It means that if the net force on an object is zero, then the velocity of the object is constant. Velocity is a vector quantity which expresses both the object's speed and the direction of its motion.", font: `400 14px ${FONT_FAMILY}`, color: "#a3a3a3", lineHeight: 22 },
  { type: 'heading', text: "II. FORCE", font: `700 18px ${FONT_FAMILY}`, color: "#ff4444", lineHeight: 32 },
  { type: 'paragraph', text: "When a net force acts on a body, the body accelerates. The acceleration is proportional to the net force and inversely proportional to the mass. F = ma. The second law states that the rate of change of momentum of a body is directly proportional to the force applied, and this change in momentum takes place in the direction of the applied force.", font: `400 14px ${FONT_FAMILY}`, color: "#a3a3a3", lineHeight: 22 },
  { type: 'heading', text: "III. REACTION", font: `700 18px ${FONT_FAMILY}`, color: "#ff4444", lineHeight: 32 },
  { type: 'paragraph', text: "When one body exerts a force on a second body, the second body simultaneously exerts a force equal in magnitude and opposite in direction on the first body. This means that for every action, there is an equal and opposite reaction. The third law states that all forces between two objects exist in equal magnitude and opposite direction.", font: `400 14px ${FONT_FAMILY}`, color: "#a3a3a3", lineHeight: 22 }
];

interface PremeasuredSection {
  type: string;
  font: string;
  color: string;
  lineHeight: number;
  words: { text: string; width: number }[];
  spaceWidth: number;
}

interface WordLayout {
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
}

let premeasuredText: PremeasuredSection[] | null = null;

function getPremeasuredText(ctx: CanvasRenderingContext2D): PremeasuredSection[] {
  if (premeasuredText) return premeasuredText;
  
  premeasuredText = textContent.map(section => {
    ctx.font = section.font;
    return {
      type: section.type,
      font: section.font,
      color: section.color,
      lineHeight: section.lineHeight,
      spaceWidth: ctx.measureText(' ').width,
      words: section.text.split(' ').map(word => ({
        text: word,
        width: ctx.measureText(word).width
      }))
    };
  });
  return premeasuredText;
}

function drawMask(ctx: CanvasRenderingContext2D, width: number, height: number, time: number) {
  // Fill black (blocked space)
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  // Draw white columns (free space)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(40, 40, 340, 520);
  ctx.fillRect(420, 40, 340, 520);

  // Draw moving object (black) to subtract from free space
  const cx = width / 2 + Math.sin(time * 0.7) * 250;
  const cy = height / 2 + Math.sin(time * 1.1) * 180;
  const maskRadius = 90; // Slightly larger than visual radius for text padding

  ctx.beginPath();
  ctx.arc(cx, cy, maskRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();
}

function generateIntegralImage(ctx: CanvasRenderingContext2D, width: number, height: number, integral: Int32Array) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // Red channel > 128 means free space (white)
      const val = data[idx] > 128 ? 1 : 0;
      rowSum += val;
      const top = y > 0 ? integral[(y - 1) * width + x] : 0;
      integral[y * width + x] = top + rowSum;
    }
  }
}

function isSpaceFree(integral: Int32Array, width: number, x: number, y: number, w: number, h: number) {
  const x1 = Math.max(0, Math.floor(x));
  const y1 = Math.max(0, Math.floor(y));
  const x2 = Math.min(width - 1, Math.floor(x + w - 1));
  const y2 = Math.min(integral.length / width - 1, Math.floor(y + h - 1));

  if (x1 > x2 || y1 > y2) return false;

  const A = (y1 > 0 && x1 > 0) ? integral[(y1 - 1) * width + (x1 - 1)] : 0;
  const B = (y1 > 0) ? integral[(y1 - 1) * width + x2] : 0;
  const C = (x1 > 0) ? integral[y2 * width + (x1 - 1)] : 0;
  const D = integral[y2 * width + x2];

  const sum = D - B - C + A;
  const area = (x2 - x1 + 1) * (y2 - y1 + 1);

  return sum === area;
}

function calculateLayout(integral: Int32Array, width: number, height: number, measureCtx: CanvasRenderingContext2D) {
  const layout: WordLayout[] = [];
  const sections = getPremeasuredText(measureCtx);

  const columns = [
    { x: 40, y: 40, w: 340, h: 520 },
    { x: 420, y: 40, w: 340, h: 520 }
  ];

  let currentColumnIdx = 0;
  let col = columns[currentColumnIdx];
  let curX = col.x;
  let curY = col.y;

  for (const section of sections) {
    // Add spacing before headings
    if (section.type === 'heading' && curY > col.y) {
      curY += 10;
    }

    const h = section.lineHeight;

    for (let i = 0; i < section.words.length; i++) {
      const word = section.words[i];
      const wordWidth = word.width;

      let placed = false;

      while (!placed) {
        const effectiveWordWidth = Math.min(wordWidth, col.w);
        
        // Wrap to next line if word exceeds column width
        if (curX + effectiveWordWidth > col.x + col.w && curX > col.x) {
          curX = col.x;
          curY += h;
          continue;
        }

        // Move to next column if we exceed column height
        if (curY + h > col.y + col.h) {
          currentColumnIdx++;
          if (currentColumnIdx >= columns.length) {
            return layout; // Out of space
          }
          col = columns[currentColumnIdx];
          curX = col.x;
          curY = col.y;
          continue;
        }

        // Check if space is free (using a slightly smaller bounding box for tighter wrapping)
        const checkH = Math.max(1, Math.floor(h * 0.6));
        const checkY = Math.floor(curY + (h - checkH) / 2);
        
        if (isSpaceFree(integral, width, curX, checkY, wordWidth, checkH)) {
          layout.push({
            text: word.text,
            x: curX,
            y: curY + h * 0.8, // Approximate baseline
            font: section.font,
            color: section.color
          });
          curX += wordWidth + section.spaceWidth;
          placed = true;
        } else {
          // Advance cursor to find free space
          curX += 4;
        }
      }
    }
    
    // Paragraph break
    curY += h;
    curX = col.x;
  }

  return layout;
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, width, height);

  // Subtle grid
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < width; x += 40) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y < height; y += 40) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, layout: WordLayout[], time: number) {
  drawBackground(ctx, width, height);

  // Draw the moving object (glowing orb)
  const cx = width / 2 + Math.sin(time * 0.7) * 250;
  const cy = height / 2 + Math.sin(time * 1.1) * 180;
  const radius = 70;

  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 2);
  gradient.addColorStop(0, 'rgba(255, 68, 68, 1)');
  gradient.addColorStop(0.4, 'rgba(255, 68, 68, 0.5)');
  gradient.addColorStop(1, 'rgba(255, 68, 68, 0)');
  
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 2, 0, Math.PI * 2);
  ctx.fill();

  // Core
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Fade in text over the first 2 seconds
  const alpha = Math.min(1, time / 2);
  ctx.globalAlpha = alpha;

  // Draw text
  let currentFont = '';
  let currentColor = '';

  for (const word of layout) {
    if (currentFont !== word.font) {
      currentFont = word.font;
      ctx.font = currentFont;
    }
    if (currentColor !== word.color) {
      currentColor = word.color;
      ctx.fillStyle = currentColor;
    }
    ctx.fillText(word.text, word.x, word.y);
  }
  
  ctx.globalAlpha = 1;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Setup offscreen canvas for mask
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskCtx) return;

    const integral = new Int32Array(canvas.width * canvas.height);
    let animationFrameId: number;
    const startTime = performance.now();

    const render = (now: number) => {
      const time = (now - startTime) / 1000;
      
      drawMask(maskCtx, canvas.width, canvas.height, time);
      generateIntegralImage(maskCtx, canvas.width, canvas.height, integral);
      const layout = calculateLayout(integral, canvas.width, canvas.height, maskCtx);
      drawScene(ctx, canvas.width, canvas.height, layout, time);

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 p-4 font-sans">
      <div className="relative">
        <canvas 
          ref={canvasRef} 
          width={800} 
          height={600} 
          className="rounded-xl shadow-2xl shadow-red-900/20 border border-neutral-800 bg-black"
        />
        <div className="absolute bottom-4 left-4 text-neutral-500 text-xs pointer-events-none">
          Pixel-based reflow engine active. Mask updates at 60fps.
        </div>
      </div>
    </div>
  );
}
