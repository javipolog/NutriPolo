// Client profile options: the first value is what is stored on the client,
// the second is the i18n key of its label.

export const GOALS = [
  ['perdida_grasa',         'goal_fat_loss'],
  ['ganancia_muscular',     'goal_muscle_gain'],
  ['mejora_digestiva',      'goal_digestive'],
  ['rendimiento_deportivo', 'goal_sports'],
  ['dietoterapia',          'goal_dietotherapy'],
  ['relacion_alimentacion', 'goal_food_relationship'],
];

export const DIET_RESTRICTIONS = [
  ['vegetariano', 'diet_vegetarian'],
  ['vegano',      'diet_vegan'],
  ['sin_gluten',  'diet_gluten_free'],
  ['sin_lactosa', 'diet_lactose_free'],
  ['sin_cerdo',   'diet_no_pork'],
  ['halal',       'diet_halal'],
];

export const ACTIVITY_LEVELS = [
  ['sedentario', 'activity_sedentary'],
  ['ligero',     'activity_light'],
  ['moderado',   'activity_moderate'],
  ['activo',     'activity_active'],
  ['muy_activo', 'activity_very_active'],
];

/** Translated label for a stored option id; unknown ids are shown as stored. */
export const optionLabel = (options, t, id) => {
  const key = options.find(([value]) => value === id)?.[1];
  return key ? t[key] : id;
};
