import { Route, Switch } from 'wouter';
import ErrorBoundary from './components/ErrorBoundary';
import LearningShell from './components/LearningShell';
import { LearningProvider } from './contexts/LearningContext';
import Home from './pages/Home';
import Library from './pages/Library';
import CourseDetail from './pages/CourseDetail';
import Lesson from './pages/Lesson';
import MyLearning from './pages/MyLearning';
import Resources from './pages/Resources';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <ErrorBoundary>
      <LearningProvider>
        <LearningShell>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/courses" component={Library} />
            <Route path="/courses/:courseId" component={CourseDetail} />
            <Route path="/learn/:courseId/:lessonId" component={Lesson} />
            <Route path="/my-learning" component={MyLearning} />
            <Route path="/resources" component={Resources} />
            <Route path="/404" component={NotFound} />
            <Route component={NotFound} />
          </Switch>
        </LearningShell>
      </LearningProvider>
    </ErrorBoundary>
  );
}
