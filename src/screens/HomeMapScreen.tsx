import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, SafeAreaView, Switch } from 'react-native';
import { tokens } from '../theme/tokens';
import { Search, MapPin, Bath, Baby, Coffee, Activity, Navigation, AlertTriangle } from 'lucide-react-native';
import { Card } from '../components/Card';
import { Button } from '../components/Button';

export const HomeMapScreen = () => {
  const [comfortMode, setComfortMode] = useState(true);

  const quickActions = [
    { id: 'bathroom', label: 'Bathroom', icon: Bath },
    { id: 'nursing', label: 'Nursing', icon: Baby },
    { id: 'rest_stop', label: 'Rest Stop', icon: Coffee },
    { id: 'hospital', label: 'Hospital', icon: Activity },
  ];

  return (
    <View className="flex-1 bg-gray-100">
      {/* Mock Map Area */}
      <View className="flex-1 bg-blue-50 items-center justify-center">
        <MapPin size={48} color={tokens.colors.primary} />
        <Text className="text-muted mt-2">Map view goes here</Text>
      </View>

      {/* Top Floating Search */}
      <SafeAreaView className="absolute top-0 left-0 right-0 p-4">
        <Card className="flex-row items-center px-4 h-14" padding="none">
          <Search size={20} color={tokens.colors.muted} />
          <TextInput 
            className="flex-1 ml-3 text-lg text-ink"
            placeholder="Search destination..."
            placeholderTextColor={tokens.colors.muted}
          />
        </Card>
      </SafeAreaView>

      {/* Floating Comfort Toggle */}
      <View className="absolute top-24 right-4">
        <Card className="flex-row items-center px-3 py-2" padding="none">
          <Text className="text-sm font-medium text-ink mr-2">Comfort Route</Text>
          <Switch 
            value={comfortMode} 
            onValueChange={setComfortMode}
            trackColor={{ false: '#767577', true: tokens.colors.primary }}
          />
        </Card>
      </View>

      {/* Bottom Interface */}
      <View className="absolute bottom-0 left-0 right-0 p-4 pb-10">
        <View className="flex-row justify-between mb-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <TouchableOpacity key={action.id} className="items-center w-1/4">
                <View className="bg-white p-4 rounded-2xl mb-1 shadow-sm border border-gray-100">
                  <Icon size={24} color={tokens.colors.primary} />
                </View>
                <Text className="text-xs font-medium text-ink">{action.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Button 
          label="LABOR MODE" 
          onPress={() => console.log('Labor Mode')}
          variant="secondary"
          size="lg"
          className="rounded-full shadow-lg"
          icon={<AlertTriangle color="white" size={24} />}
        />
      </View>
    </View>
  );
};
