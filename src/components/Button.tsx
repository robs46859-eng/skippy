import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, View } from 'react-native';
import { tokens } from '../theme/tokens';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  className = '',
}) => {
  const baseStyle = "flex-row items-center justify-center rounded-xl";
  
  const variantStyles = {
    primary: "bg-primary text-white",
    secondary: "bg-accent text-white",
    outline: "border border-primary bg-transparent",
    ghost: "bg-transparent",
  };

  const sizeStyles = {
    sm: "px-4 py-2",
    md: "px-6 py-3",
    lg: "px-8 py-4",
  };

  const textStyles = {
    primary: "text-white font-semibold",
    secondary: "text-white font-semibold",
    outline: "text-primary font-semibold",
    ghost: "text-primary font-semibold",
  };

  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      className={`${baseStyle} ${variantStyles[variant]} ${sizeStyles[size]} ${isDisabled ? 'opacity-50' : ''} ${className}`}
      style={variant === 'ghost' ? {} : tokens.shadows.soft}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'outline' || variant === 'ghost' ? tokens.colors.primary : 'white'} />
      ) : (
        <View className="flex-row items-center">
          {icon && <View className="mr-2">{icon}</View>}
          <Text className={textStyles[variant]}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};
