import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';
import { defineTool } from '../registry.js';
import { Agent } from '../../agent.js';

export const generateImage = defineTool({
  name: 'generate_image',
  description: 'Generates an image from a text description and saves it locally.',
  parameters: z.object({
    prompt: z.string().describe('The text prompt describing the image to generate.'),
    imageName: z.string().describe('A descriptive filename to save the image (e.g. "beach_sunset").'),
    imagePaths: z.array(z.string()).optional().describe('Optional list of existing local image paths to edit.')
  }),
  execute: async ({ prompt, imageName, imagePaths }, ctx) => {
    const agent = ctx.getState('agent') as Agent | undefined;
    if (!agent) {
      throw new Error('Image generation failed: Parent agent context is missing.');
    }

    const apiKey = agent.config.apiKey;
    if (!apiKey) {
      throw new Error('Image generation failed: API key is not configured.');
    }

    const ai = new GoogleGenAI({ apiKey });

    // Determine output directory: default to appDataDir/images or cwd
    const outputDir = path.join(agent.config.appDataDir!, 'images');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const cleanFilename = imageName.toLowerCase().replace(/[^a-z0-9_]/g, '') + '.jpg';
    const outputPath = path.join(outputDir, cleanFilename);

    try {
      console.log(`Generating image for prompt: "${prompt}"...`);
      const response = await ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: '1:1'
        }
      });

      const base64Bytes = response.generatedImages?.[0]?.image?.imageBytes;
      if (!base64Bytes) {
        throw new Error('No image bytes returned from the API.');
      }

      const buffer = Buffer.from(base64Bytes, 'base64');
      fs.writeFileSync(outputPath, buffer);

      return {
        status: 'success',
        path: outputPath,
        message: `Image generated and saved successfully to ${outputPath}`
      };
    } catch (err: any) {
      console.error(`Imagen generation error: ${err.message}`);
      // Fallback: save a mock placeholder file if API fails (e.g. billing/quota limits) so flow doesn't crash
      const mockBuffer = Buffer.alloc(100); // 100 bytes dummy image
      fs.writeFileSync(outputPath, mockBuffer);
      return {
        status: 'mock_fallback',
        path: outputPath,
        message: `Saved placeholder image to ${outputPath} (API call failed: ${err.message})`
      };
    }
  }
});
