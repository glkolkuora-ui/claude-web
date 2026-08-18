export interface Module {
  id: string
  title: string
  description: string | null
  order_index: number
  is_published: boolean
}

export interface LessonMaterial {
  id: string
  lesson_id: string
  title: string
  url: string
  type: 'pdf' | 'sheet' | 'link' | 'video' | 'document' | 'other'
  order_index: number
}

export interface Lesson {
  id: string
  module_id: string
  title: string
  description: string | null
  youtube_url: string
  youtube_video_id: string
  duration_seconds: number | null
  order_index: number
  is_published: boolean
  materials?: LessonMaterial[]
  is_watched?: boolean
}

export interface ModuleWithLessons extends Module {
  lessons: Lesson[]
}
