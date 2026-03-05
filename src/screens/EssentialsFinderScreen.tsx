import React from 'react';
import { View, Text, FlatList, TouchableOpacity, Image } from 'react-native';
import { tokens } from '../theme/tokens';
import { Star, MapPin, ChevronRight, Bath, Baby, Coffee } from 'lucide-react-native';
import { Card } from '../components/Card';

const mockPlaces = [
  { id: '1', name: 'Starbucks Nursing Suite', category: 'nursing', distance: '0.4 mi', rating: 4.8, reviews: 12, address: '123 Main St' },
  { id: '2', name: 'Whole Foods Restroom', category: 'bathroom', distance: '0.8 mi', rating: 4.2, reviews: 45, address: '456 Oak Ave' },
  { id: '3', name: 'Public Park Rest Area', category: 'rest_stop', distance: '1.2 mi', rating: 3.9, reviews: 8, address: '789 Park Rd' },
];

const categoryIcons = {
  nursing: Baby,
  bathroom: Bath,
  rest_stop: Coffee,
  hospital: MapPin,
};

export const EssentialsFinderScreen = () => {
  return (
    <View className="flex-1 bg-background">
      <View className="p-4 pt-12">
        <Text className="text-2xl font-bold text-ink mb-4">Nearby Essentials</Text>
        
        {/* Filter Chips */}
        <View className="flex-row mb-6">
          {['All', 'Bathroom', 'Nursing', 'Rest Stop'].map((filter, i) => (
            <TouchableOpacity 
              key={filter} 
              className={`px-4 py-2 rounded-full mr-2 ${i === 0 ? 'bg-primary' : 'bg-white border border-gray-200'}`}
            >
              <Text className={`font-medium ${i === 0 ? 'text-white' : 'text-muted'}`}>{filter}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <FlatList 
          data={mockPlaces}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const Icon = categoryIcons[item.category as keyof typeof categoryIcons];
            return (
              <Card className="mb-4 flex-row items-center p-3" padding="none">
                <View className="w-16 h-16 bg-blue-50 rounded-xl items-center justify-center mr-4">
                  <Icon size={24} color={tokens.colors.primary} />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-bold text-ink" numberOfLines={1}>{item.name}</Text>
                  <Text className="text-sm text-muted mb-1">{item.address} • {item.distance}</Text>
                  <View className="flex-row items-center">
                    <Star size={14} color="#FFD700" fill="#FFD700" />
                    <Text className="text-sm font-semibold text-ink ml-1">{item.rating}</Text>
                    <Text className="text-sm text-muted ml-1">({item.reviews} reviews)</Text>
                  </View>
                </View>
                <ChevronRight size={20} color={tokens.colors.muted} />
              </Card>
            );
          }}
        />
      </View>
    </View>
  );
};
