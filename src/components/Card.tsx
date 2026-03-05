import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { tokens } from '../theme/tokens';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({ 
  children, 
  style, 
  className = '', 
  padding = 'md' 
}) => {
  const paddingStyles = {
    none: 'p-0',
    sm: 'p-2',
    md: 'p-4',
    lg: 'p-6',
  };

  return (
    <View 
      className={`bg-white rounded-2xl ${paddingStyles[padding]} ${className}`}
      style={[tokens.shadows.soft, style]}
    >
      {children}
    </View>
  );
};
