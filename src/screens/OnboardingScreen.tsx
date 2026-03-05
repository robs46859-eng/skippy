import React, { useState } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, ScrollView } from 'react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { tokens } from '../theme/tokens';
import { Baby, Heart, Calendar, ArrowRight } from 'lucide-react-native';

const stages = [
  { id: 'trying', label: 'Trying', icon: Heart },
  { id: '1st', label: '1st Trimester', icon: Baby },
  { id: '2nd', label: '2nd Trimester', icon: Baby },
  { id: '3rd', label: '3rd Trimester', icon: Baby },
  { id: 'infant', label: 'Infant', icon: Baby },
];

export const OnboardingScreen = () => {
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="mb-10 mt-6">
          <Text className="text-3xl font-bold text-ink mb-2">Welcome to Skipper</Text>
          <Text className="text-lg text-muted">A calm, safe journey for you and your little one.</Text>
        </View>

        <Text className="text-xl font-semibold text-ink mb-4">Where are you in your journey?</Text>
        
        <View className="flex-row flex-wrap justify-between">
          {stages.map((stage) => {
            const Icon = stage.icon;
            const isSelected = selectedStage === stage.id;
            
            return (
              <TouchableOpacity
                key={stage.id}
                onPress={() => setSelectedStage(stage.id)}
                className="w-[48%] mb-4"
              >
                <Card 
                  className={`items-center justify-center h-32 border-2 ${isSelected ? 'border-primary' : 'border-transparent'}`}
                  padding="md"
                >
                  <Icon size={32} color={isSelected ? tokens.colors.primary : tokens.colors.muted} />
                  <Text className={`mt-2 font-medium ${isSelected ? 'text-primary' : 'text-muted'}`}>
                    {stage.label}
                  </Text>
                </Card>
              </TouchableOpacity>
            );
          })}
        </View>

        <View className="mt-8">
          <Button 
            label="Continue" 
            onPress={() => console.log('Continue', selectedStage)}
            disabled={!selectedStage}
            icon={<ArrowRight color="white" size={20} />}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
