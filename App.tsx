import React, { useState, useCallback } from 'react';
import { ImageUploader } from './components/ImageUploader';
import { ResultsDisplay } from './components/ResultsDisplay';
import { LoadingOverlay } from './components/LoadingOverlay';
import { SparklesIcon } from './components/icons/SparklesIcon';
import { identifyClothingItems, generateProductImageFromPhoto } from './services/geminiService';
import { ExtractedClothingItem, ClothingItemDescription } from './types';

const App: React.FC = () => {
  const [originalImageFile, setOriginalImageFile] = useState<File | null>(null);
  const [originalImagePreview, setOriginalImagePreview] = useState<string | null>(null);
  const [extractedItems, setExtractedItems] = useState<ExtractedClothingItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleImageSelect = (file: File) => {
    setOriginalImageFile(file);
    setOriginalImagePreview(URL.createObjectURL(file));
    setExtractedItems([]);
    setError(null);
  };

  const handleExtractClothing = useCallback(async () => {
    if (!originalImageFile) return;

    setIsLoading(true);
    setError(null);
    setExtractedItems([]);

    try {
      setLoadingMessage('...تحليل الأزياء في الصورة');
      const itemsToGenerate: ClothingItemDescription[] = await identifyClothingItems(originalImageFile);

      if (!itemsToGenerate || itemsToGenerate.length === 0) {
        throw new Error('لم يتم العثور على أي قطع ملابس واضحة في الصورة.');
      }
      
      const generatedItems: ExtractedClothingItem[] = [];
      let hasQuotaError = false;
      for (let i = 0; i < itemsToGenerate.length; i++) {
        const item = itemsToGenerate[i];
        setLoadingMessage(`...جاري إنشاء صورة لـ: ${item.item_name} (${i + 1}/${itemsToGenerate.length})`);
        
        try {
            const generatedImage = await generateProductImageFromPhoto(originalImageFile, item.detailed_description);
            generatedItems.push({
                name: item.item_name,
                imageUrl: `data:${generatedImage.mimeType};base64,${generatedImage.base64}`,
            });
        } catch (err) {
            console.error(err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            let itemError = 'فشل الإنشاء';
            if (/quota|429|RESOURCE_EXHAUSTED/i.test(errorMessage)) {
              hasQuotaError = true;
              itemError = 'تم تجاوز الحصة';
            } else if (/safety|filters|blocked/i.test(errorMessage)) {
              itemError = 'تم الحظر للسلامة';
            }
            
            generatedItems.push({
              name: item.item_name,
              error: itemError,
            });
        }
        setExtractedItems([...generatedItems]);
      }
      if (hasQuotaError) {
          setError('تم تجاوز حصة الاستخدام. فشل إنشاء بعض الصور. يرجى المحاولة مرة أخرى لاحقًا.');
      }

    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  }, [originalImageFile]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center p-4 sm:p-8">
      {isLoading && <LoadingOverlay message={loadingMessage} />}
      <main className="w-full max-w-6xl mx-auto flex flex-col items-center">
        <header className="text-center mb-8 w-full">
          <div className="flex items-center justify-center gap-4">
            <SparklesIcon className="w-10 h-10 text-purple-400" />
            <h1 className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-purple-400 to-indigo-400 text-transparent bg-clip-text">
              مستخرج الأزياء
            </h1>
            <SparklesIcon className="w-10 h-10 text-indigo-400" />
          </div>
          <p className="mt-4 text-lg text-gray-400 max-w-2xl mx-auto">
            ارفع صورة لعرض الأزياء وسيقوم الذكاء الاصطناعي باستخراج قطع الملابس لك.
          </p>
        </header>

        {!originalImagePreview && (
          <ImageUploader onImageSelect={handleImageSelect} />
        )}
        
        {originalImagePreview && (
          <div className="w-full">
            <ResultsDisplay 
              originalImagePreview={originalImagePreview}
              extractedItems={extractedItems}
            />
            
            <div className="mt-8 flex flex-col sm:flex-row justify-center items-center gap-4">
              <button 
                onClick={handleExtractClothing}
                disabled={isLoading}
                className="w-full sm:w-auto flex items-center justify-center gap-3 text-lg font-bold bg-purple-600 hover:bg-purple-700 disabled:bg-purple-900 disabled:text-gray-500 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-lg shadow-purple-900/50"
              >
                <SparklesIcon className="w-6 h-6"/>
                {extractedItems.length > 0 ? 'إعادة الاستخراج' : 'استخراج الملابس'}
              </button>
              <button 
                onClick={() => {
                  setOriginalImageFile(null);
                  setOriginalImagePreview(null);
                  setExtractedItems([]);
                  setError(null);
                }}
                disabled={isLoading}
                className="w-full sm:w-auto text-lg font-bold bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg transition-colors duration-300"
              >
                تغيير الصورة
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-6 bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-center">
            <p><span className="font-bold">خطأ: </span>{error}</p>
          </div>
        )}
      </main>
      <footer className="text-center text-gray-500 mt-12 text-sm">
        <p>مدعوم بواسطة Gemini AI</p>
      </footer>
    </div>
  );
};

export default App;
