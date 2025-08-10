import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';

export default function withForm({schema, defaults}){
  return function useZodForm(overrides={}){
    return useForm({
      resolver: schema? zodResolver(schema): undefined,
      defaultValues: defaults || {},
      ...overrides
    });
  };
}
