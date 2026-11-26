export interface ClothingItemDescription {
  item_name: string;
  detailed_description: string;
}

export interface ExtractedClothingItem {
  name: string;
  imageUrl?: string;
  error?: string;
}
