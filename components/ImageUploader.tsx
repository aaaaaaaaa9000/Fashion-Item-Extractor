
import React, { useCallback, useState } from 'react';
import { ImageIcon } from './icons/ImageIcon';

interface ImageUploaderProps {
  onImageSelect: (file: File) => void;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageSelect }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onImageSelect(e.target.files[0]);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onImageSelect(e.dataTransfer.files[0]);
    }
  }, [onImageSelect]);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  return (
    <div className="w-full max-w-2xl mt-8">
      <label
        htmlFor="image-upload"
        className={`relative block w-full h-80 rounded-2xl border-2 border-dashed transition-colors duration-300 cursor-pointer
        ${isDragging ? 'border-purple-500 bg-purple-900/20' : 'border-gray-600 hover:border-purple-500 hover:bg-gray-800'}`}
      >
        <div
          className="flex flex-col items-center justify-center h-full"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
        >
          <ImageIcon className="w-20 h-20 text-gray-500 mb-4 transition-transform duration-300 transform group-hover:scale-110" />
          <span className="text-lg font-semibold text-gray-300">اختر صورة</span>
          <p className="text-gray-500 mt-2">أو اسحب وأفلت الصورة هنا</p>
        </div>
      </label>
      <input
        type="file"
        id="image-upload"
        className="hidden"
        accept="image/png, image/jpeg, image/webp"
        onChange={handleFileChange}
      />
    </div>
  );
};
