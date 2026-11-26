import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ClothingItemDescription } from '../types';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = (error) => reject(error);
  });
};

export const identifyClothingItems = async (imageFile: File): Promise<ClothingItemDescription[]> => {
  const base64Image = await fileToBase64(imageFile);
  const imagePart = {
    inlineData: {
      mimeType: imageFile.type,
      data: base64Image,
    },
  };

  const textPart = {
    text: `
      You are a hyper-detailed fashion analyst AI. Your sole purpose is to analyze the provided image and extract exact, objective descriptions of every clothing item, accessory, and footwear piece worn by the person. The description's accuracy is paramount as it will be used to generate a new, photorealistic product image.

      For each item you identify, provide:
      1.  **item_name**: A concise name (e.g., "Black Cotton T-Shirt with 'ROCK' print").
      2.  **detailed_description**: An exhaustive and literal description based *only* on what is visible. Do not invent details.
          *   **Type**: e.g., 'crew-neck t-shirt', 'skinny-fit jeans'.
          *   **Color**: Be extremely specific. Use precise color names (e.g., 'charcoal gray', 'cream white', 'royal blue'). Mention any color variations, shades, or gradients.
          *   **Material/Texture**: Describe the visible texture and material (e.g., 'heavy-knit cotton', 'worn-in light-wash denim', 'silky satin', 'pebbled leather').
          *   **Pattern/Graphics**: Describe any patterns, prints, logos, text, or graphics literally. If there is text, transcribe it exactly, including capitalization and font style if discernible. If there's a graphic, describe its colors, shapes, and placement in detail (e.g., "a red and yellow circular logo with the word 'VINTAGE' in white serif font in the center").
          *   **Fit/Cut**: e.g., 'oversized fit', 'cropped length ending at the navel', 'high-waisted', 'bootcut'.
          *   **Features**: Mention every visible detail: 'silver-tone zipper', 'five-pocket design', 'ribbed cuffs', 'V-neckline', 'rolled-up short sleeves', 'contrast stitching in white thread'.

      **CRITICAL RULES:**
      -   **ABSOLUTE OBJECTIVITY:** Describe ONLY what you see. DO NOT infer details or add information not present in the image.
      -   **IGNORE THE CONTEXT:** Do not describe the person, their pose, the background, or lighting. Focus ONLY on the clothing item itself.
      -   **LITERAL DESCRIPTION:** Your description must be a recipe for another AI to perfectly recreate the item.
      -   Return a valid JSON array of objects with "item_name" and "detailed_description" keys.
    `,
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [imagePart, textPart] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              item_name: {
                type: Type.STRING,
                description: 'A concise, clear name for the clothing item (e.g., "White Graphic T-Shirt").',
              },
              detailed_description: {
                type: Type.STRING,
                description: 'A very detailed and objective description of the item based only on the image, covering type, color, material, pattern, fit, and key features. This will be used for image generation.',
              },
            },
            required: ['item_name', 'detailed_description'],
          },
        },
      },
    });

    const jsonText = response.text.trim();
    const result = JSON.parse(jsonText) as ClothingItemDescription[];
    return result;

  } catch (error) {
    console.error("Error identifying clothing items:", error);
    throw new Error("فشل تحليل الصورة. حاول مرة أخرى بصورة مختلفة.");
  }
};

interface GeneratedImage {
  base64: string;
  mimeType: string;
}

export const generateProductImageFromPhoto = async (originalImageFile: File, description: string): Promise<GeneratedImage> => {
  const base64Image = await fileToBase64(originalImageFile);

  const imagePart = {
    inlineData: {
      data: base64Image,
      mimeType: originalImageFile.type,
    },
  };

  const textPart = {
    text: `You are a world-class AI photo editor specializing in creating ultra-high-quality product images for luxury e-commerce platforms. Your task is to meticulously isolate a specific clothing item from the provided photo, ensuring the final output is of the highest possible fidelity.

The item to isolate is: "${description}".

**Execution Protocol:**
1.  **Precision Isolation:** Locate the described item in the source image with sub-pixel accuracy.
2.  **Flawless Extraction:** Perform a perfect cutout of the item. This is the most critical phase. You MUST preserve every single detail from the original photo: the exact weave of the fabric, the subtle variations in color, the precise rendering of text and graphics, and the natural texture. The goal is zero loss of detail. The result should be indistinguishable from a professional studio photograph of the original item.
3.  **Seamless Reconstruction:** Intelligently and photorealistically reconstruct any parts of the clothing item that are obscured by the model (e.g., arms, other clothing, hair). The reconstructed areas must perfectly match the texture, lighting, and material of the visible parts.
4.  **Studio Presentation:** Place the completed, hyper-realistic item on a completely neutral, light gray (#f0f0f0) studio background. The lighting on the item should be soft and even, highlighting its quality without creating harsh shadows.

**Final Output Requirements:**
-   The output must be a high-resolution image of ONLY the clothing item.
-   No text, watermarks, or other artifacts.
-   The quality must be impeccable, suitable for a premium online store.`,
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [imagePart, textPart] },
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });

    const imagePartResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

    if (imagePartResponse?.inlineData) {
      return {
          base64: imagePartResponse.inlineData.data,
          mimeType: imagePartResponse.inlineData.mimeType,
      };
    } else {
      const textPartResponse = response.candidates?.[0]?.content?.parts?.find(part => part.text);
      const refusalReason = textPartResponse?.text || "No image was generated. The model may have refused the request due to safety policies.";
      throw new Error(`Image generation failed: ${refusalReason}`);
    }
  } catch (error) {
    console.error("Error generating product image:", error);
    if (error instanceof Error) {
        if (/safety|policy|blocked/i.test(error.message)) {
            throw new Error("تم الحظر لأسباب تتعلق بالسلامة.");
        }
        throw error;
    }
    throw new Error("An unknown error occurred during image generation.");
  }
};