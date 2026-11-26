import React from 'react';
import { ExtractedClothingItem } from '../types';
import { DownloadIcon } from './icons/DownloadIcon';

interface ResultsDisplayProps {
  originalImagePreview: string;
  extractedItems: ExtractedClothingItem[];
}

const ErrorIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const ResultItem: React.FC<{ item: ExtractedClothingItem }> = ({ item }) => {
  if (item.error) {
    return (
      <div className="group relative flex flex-col items-center justify-center text-center overflow-hidden rounded-lg bg-red-900/20 border border-red-700 aspect-square p-2">
        <ErrorIcon className="w-8 h-8 text-red-400 mb-2" />
        <p className="text-sm font-semibold text-red-300">{item.name}</p>
        <p className="text-xs text-red-400 mt-1">{item.error}</p>
      </div>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-lg bg-gray-800 shadow-md transform transition-transform duration-300 hover:scale-105 hover:shadow-purple-900/50">
      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover aspect-square" />
      
      {/* Hover Overlay */}
      <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-2">
        {/* Download Button */}
        <a
          href={item.imageUrl}
          download={`${item.name.replace(/\s+/g, '_')}.png`}
          className="self-end p-2 bg-gray-700/80 rounded-full hover:bg-purple-600 transition-colors"
          aria-label={`Download ${item.name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <DownloadIcon className="w-5 h-5 text-white" />
        </a>

        {/* Item Name */}
        <div className="text-center text-white text-sm font-semibold">
          {item.name}
        </div>
      </div>
    </div>
  );
};


export const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ originalImagePreview, extractedItems }) => {
  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
      {/* Original Image Section */}
      <div className="flex flex-col items-center">
        <h2 className="text-2xl font-bold mb-4 text-gray-300">الصورة الأصلية</h2>
        <div className="w-full max-w-md aspect-w-3 aspect-h-4 bg-gray-800 rounded-lg overflow-hidden shadow-lg">
          <img src={originalImagePreview} alt="Original model" className="object-contain w-full h-full" />
        </div>
      </div>
      
      {/* Extracted Items Section */}
      <div className="flex flex-col items-center">
        <h2 className="text-2xl font-bold mb-4 text-gray-300">القطع المستخرجة</h2>
        {extractedItems.length > 0 ? (
          <div className="w-full grid grid-cols-2 sm:grid-cols-3 gap-4">
            {extractedItems.map((item, index) => (
              <ResultItem key={index} item={item} />
            ))}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-800 rounded-lg p-8 border-2 border-dashed border-gray-700">
            <p className="text-gray-500 text-center">سيتم عرض قطع الملابس المستخرجة هنا.</p>
          </div>
        )}
      </div>
    </div>
  );
};